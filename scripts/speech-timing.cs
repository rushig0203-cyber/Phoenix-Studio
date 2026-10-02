using System;
using System.Collections.Generic;
using System.IO;
using System.Speech.Synthesis;

// Native callbacks avoid PowerShell runspace/event queue races during Speak().
public sealed class PhoenixSpeechCapture : IDisposable {
    public sealed class Word { public string text; public double seconds; public int characterPosition; public int speaker; }
    public sealed class Mouth { public double seconds; public double duration; public int viseme; public int speaker; }
    public sealed class Mark { public string name; public double seconds; }
    private readonly SpeechSynthesizer synth;
    private readonly object gate = new object();
    private readonly List<Word> words = new List<Word>();
    private readonly List<Mouth> mouths = new List<Mouth>();
    private readonly List<Mark> marks = new List<Mark>();
    private int speaker = -1;
    private double offset;
    private int characterBase;
    private int segmentWordStart;
    public PhoenixSpeechCapture(SpeechSynthesizer value) {
        synth = value;
        synth.SpeakProgress += OnWord;
        synth.VisemeReached += OnMouth;
        synth.BookmarkReached += OnMark;
    }
    private void OnWord(object sender, SpeakProgressEventArgs e) { lock(gate) {
        if(words.Count < 6000) words.Add(new Word { text = e.Text, seconds = offset + e.AudioPosition.TotalSeconds, characterPosition = characterBase + e.CharacterPosition, speaker = speaker });
    } }
    private void OnMouth(object sender, VisemeReachedEventArgs e) { lock(gate) {
        if(mouths.Count < 12000) mouths.Add(new Mouth { seconds = offset + e.AudioPosition.TotalSeconds, duration = e.Duration.TotalSeconds, viseme = e.Viseme, speaker = speaker });
    } }
    private void OnMark(object sender, BookmarkReachedEventArgs e) { lock(gate) {
        if(marks.Count < 1000) marks.Add(new Mark { name = e.Bookmark, seconds = offset + e.AudioPosition.TotalSeconds });
        if(e.Bookmark == "role-0") speaker = 0;
        else if(e.Bookmark == "role-1") speaker = 1;
        else if(e.Bookmark == "role-narrator") speaker = -1;
    } }
    // SAPI clocks can restart on a voice change. Each utterance gets its own
    // wave output; its offset comes from PCM samples already written, not from
    // an inferred timestamp or wall-clock execution time.
    public void BeginSegment(double seconds, int role, int textPosition) { lock(gate) {
        offset = seconds; speaker = role; characterBase = textPosition;
        segmentWordStart = words.Count;
        marks.Add(new Mark { name = role == -1 ? "role-narrator" : "role-" + role, seconds = seconds });
    } }
    public void EndSegment(double end) { lock(gate) {
        double previous = offset;
        for(int index = segmentWordStart; index < words.Count; index++) {
            double measured = words[index].seconds;
            // Desktop engines can report the final word a few milliseconds
            // beyond their PCM EOF. Permit at most 50 ms (less than one 12fps
            // frame); larger clock drift must not reach captions/animation.
            if(measured < previous || measured >= end + .05)
                throw new InvalidDataException("This installed voice returned word clocks outside its PCM segment (onset=" + measured.ToString("F4") + ", previous=" + previous.ToString("F4") + ", end=" + end.ToString("F4") + "). Select a compatible desktop voice; inaccurate timing was not accepted.");
            previous = measured;
        }
    } }
    public void EndTimeline(double seconds) { lock(gate) {
        marks.Add(new Mark { name = "phoenix-end", seconds = seconds });
    } }
    public Word[] Words() { lock(gate) { return words.ToArray(); } }
    public Mouth[] Mouths() { lock(gate) { return mouths.ToArray(); } }
    public Mark[] Marks() { lock(gate) { return marks.ToArray(); } }
    public void Dispose() {
        synth.SpeakProgress -= OnWord;
        synth.VisemeReached -= OnMouth;
        synth.BookmarkReached -= OnMark;
    }
}

// Streaming mono PCM joiner: one 8 KiB buffer, no full narration in memory.
// Fixed 16 kHz/16-bit format matches the installed desktop SAPI engines;
// avoid resampling, whose legacy AudioPosition clock uses the input byte rate.
public sealed class PhoenixWaveAssembler : IDisposable {
    private readonly FileStream output;
    private readonly BinaryWriter writer;
    private readonly byte[] buffer = new byte[8192];
    private long dataBytes;
    private bool disposed;
    public double Seconds { get { return dataBytes / 32000.0; } }
    public PhoenixWaveAssembler(string path) {
        output = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read);
        writer = new BinaryWriter(output);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(0);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16);
        writer.Write((short)1); writer.Write((short)1); writer.Write(16000);
        writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(0);
    }
    public void AppendWave(string path) {
        using(var input = File.OpenRead(path)) using(var reader = new BinaryReader(input)) {
            if(new string(reader.ReadChars(4)) != "RIFF") throw new InvalidDataException("Speech output is not RIFF audio.");
            reader.ReadUInt32();
            if(new string(reader.ReadChars(4)) != "WAVE") throw new InvalidDataException("Speech output is not WAV audio.");
            bool format = false, found = false;
            while(input.Position + 8 <= input.Length) {
                string chunk = new string(reader.ReadChars(4)); long length = reader.ReadUInt32();
                long end = input.Position + length;
                if(end > input.Length) throw new InvalidDataException("Truncated speech WAV.");
                if(chunk == "fmt ") {
                    if(length < 16 || reader.ReadUInt16() != 1 || reader.ReadUInt16() != 1 || reader.ReadUInt32() != 16000 || reader.ReadUInt32() != 32000 || reader.ReadUInt16() != 2 || reader.ReadUInt16() != 16)
                        throw new InvalidDataException("Speech WAV must be 16 kHz mono 16-bit PCM.");
                    format = true;
                } else if(chunk == "data") {
                    if(!format || length % 2 != 0 || dataBytes + length > 32000L * 600) throw new InvalidDataException("Invalid or oversized speech PCM.");
                    found = true;
                    while(length > 0) {
                        int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, length));
                        if(count == 0) throw new EndOfStreamException();
                        writer.Write(buffer, 0, count); dataBytes += count; length -= count;
                    }
                }
                input.Position = end + (end % 2);
            }
            if(!format || !found) throw new InvalidDataException("Speech WAV has no playable PCM data.");
        }
    }
    public void AppendSilence(int milliseconds) {
        if(milliseconds < 0 || milliseconds > 220) throw new ArgumentOutOfRangeException("milliseconds");
        int remaining = milliseconds * 32;
        if(dataBytes + remaining > 32000L * 600) throw new InvalidDataException("Narration exceeds ten minutes.");
        Array.Clear(buffer, 0, buffer.Length);
        while(remaining > 0) { int count = Math.Min(buffer.Length, remaining); writer.Write(buffer, 0, count); dataBytes += count; remaining -= count; }
    }
    public void Dispose() {
        if(disposed) return; disposed = true;
        output.Position = 4; writer.Write((uint)(36 + dataBytes));
        output.Position = 40; writer.Write((uint)dataBytes);
        writer.Dispose();
    }
}

param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [int]$Rate = -1,
  [string]$Voice = "",
  [string]$VoicePlanFile = "",
  [string]$TimingFile = "",
  [switch]$Song
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile)
if ([string]::IsNullOrWhiteSpace($text)) { throw "Narration text is empty." }

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$capture = $null
$assembler = $null
$partFile = $null
try {
  if (-not [string]::IsNullOrWhiteSpace($Voice)) {
    $speaker.SelectVoice($Voice)
  } else {
    $friendlyVoice = $speaker.GetInstalledVoices() |
      ForEach-Object { $_.VoiceInfo } |
      Where-Object { $_.Culture.Name -like "en-*" -and $_.Gender -eq "Female" } |
      Select-Object -First 1
    if ($friendlyVoice) { $speaker.SelectVoice($friendlyVoice.Name) }
  }
  $speaker.Rate = [Math]::Max(-3, [Math]::Min(2, $Rate))
  $speaker.Volume = 100
  $usedVoices = @($speaker.Voice.Name)
  if (-not [string]::IsNullOrWhiteSpace($TimingFile) -or -not [string]::IsNullOrWhiteSpace($VoicePlanFile)) {
    Add-Type -Path (Join-Path $PSScriptRoot 'speech-timing.cs') -ReferencedAssemblies 'System.Speech'
  }
  if (-not [string]::IsNullOrWhiteSpace($TimingFile)) {
    $capture = New-Object PhoenixSpeechCapture($speaker)
  }
  if ($Song) {
    $speaker.SetOutputToWaveFile($OutputFile)
    $lines = @($text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    # Keep pitch natural: synthetic pitch jumps sound ghostly on laptop voices.
    # Tiny changes in delivery speed provide a rhythmic chant while the original
    # instrumental arrangement carries the melody.
    $rates = @("+2%", "0%", "+1%", "-1%")
    $body = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $lines.Count; $index++) {
      $escaped = [System.Security.SecurityElement]::Escape($lines[$index].Trim())
      $lineRate = $rates[$index % $rates.Count]
      [void]$body.Append("<prosody rate='$lineRate' pitch='0%'>$escaped</prosody><break time='95ms'/>")
    }
    $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$body</speak>"
    $speaker.SpeakSsml($ssml)
  } elseif (-not [string]::IsNullOrWhiteSpace($VoicePlanFile)) {
    $plan = Get-Content -LiteralPath $VoicePlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($plan.version -ne 1 -or -not $plan.utterances -or $plan.utterances.Count -gt 250) { throw 'Invalid bounded narration plan.' }
    $primaryVoice = $speaker.Voice.Name
    $alternate = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $speaker.Voice.Culture.TwoLetterISOLanguageName -and $_.VoiceInfo.Name -ne $primaryVoice } | Sort-Object { $_.VoiceInfo.Gender -eq $speaker.Voice.Gender } | Select-Object -First 1
    $usedVoices = @($primaryVoice)
    $assembler = New-Object PhoenixWaveAssembler($OutputFile)
    $partFile = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputFile))) ('.phoenix-voice-' + [Guid]::NewGuid().ToString('N') + '.wav')
    $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $characterBase = 0
    foreach ($part in $plan.utterances) {
      if ([string]::IsNullOrWhiteSpace($part.text) -or $part.text.Length -gt 8000 -or $part.speaker -notin @(-1,0,1)) { throw 'Invalid narration utterance.' }
      $partVoice = $primaryVoice
      # An explicit user voice is authoritative. Otherwise a second installed,
      # same-language voice distinguishes the cast without downloading a model.
      # Regional accents may differ; the chosen voice names are retained for review.
      if ([string]::IsNullOrWhiteSpace($Voice) -and $part.speaker -eq 1 -and $alternate) { $partVoice = $alternate.VoiceInfo.Name }
      if ($partVoice -notin $usedVoices) { $usedVoices += $partVoice }
      $speaker.SelectVoice($partVoice)
      $speaker.SetOutputToWaveFile($partFile, $format)
      if ($capture) { $capture.BeginSegment($assembler.Seconds, [int]$part.speaker, $characterBase) }
      $speaker.Speak([string]$part.text)
      $speaker.SetOutputToNull() # Closes/flushed WAV before its PCM is measured.
      $assembler.AppendWave($partFile)
      if ($capture) { $capture.EndSegment($assembler.Seconds) }
      $assembler.AppendSilence([Math]::Max(0,[Math]::Min(220,[int]$part.pauseMs)))
      $characterBase += ([string]$part.text).Length + 1
    }
    if ($capture) { $capture.EndTimeline($assembler.Seconds) }
    $assembler.Dispose()
    $assembler = $null
  } else {
    $speaker.SetOutputToWaveFile($OutputFile)
    $speaker.Speak($text)
  }
  if ($capture) {
    $timing = @{ version=1; source='windows-speech-events'; words=@($capture.Words()); visemes=@($capture.Mouths()); bookmarks=@($capture.Marks()); voices=@($usedVoices) }
    [IO.File]::WriteAllText($TimingFile, ($timing | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  }
} finally {
  if ($capture) { $capture.Dispose() }
  $speaker.Dispose()
  if ($assembler) { $assembler.Dispose() }
  if ($partFile -and [IO.File]::Exists($partFile)) { [IO.File]::Delete($partFile) }
}

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { reviewRoot } from "./reviewFiles";
import { requireSongAudio, songAudioPath } from "./songAudio";
import { preparePixabayAnimationBackground, type PixabayAnimationCredit } from "./pixabayAnimation";
import { prepareKidsAnimation, KIDS_ANIMATION_FPS } from "./kidsAnimation";
import { getCreativeGuidance } from "./qualityManager";
import { generateWritingModel, isWritingWaitError, isWritingConfigurationError, writingModelIdentity } from "./writingModel";
import { readWritingSettings } from "./writingSettings";
import type { CreativeGuidance } from "./managerTypes";
import { checkKidsScript } from "./scriptChecks";
import { inferPublishingFormat, publishingProfile, type PublishingFormat } from "./publishingFormats";
import {
  FFMPEG_ENCODER_RESOURCE_ARGS,
  FFMPEG_FILTER_RESOURCE_ARGS,
  lowerChildProcessPriority,
} from "./renderResources";

export type KidsRenderInput = {
  scriptApproved?: boolean;
  scriptLocked?: boolean;
  sceneNarration?: string[];
  songMode?: "recording" | "local-ace";
  songAudioId?: string;
  topic: string;
  duration: number;
  creationType: "children-story" | "children-song";
  script?: string;
  voice?: string;
  aspect?: "9:16" | "16:9";
  publishingFormat?: PublishingFormat;
  targetPlatform?: string;
  seriesId?: string;
  seriesTitle?: string;
  episodeNumber?: number;
  episodeCount?: number;
  episodeBeat?: string;
};

export type KidsRenderResult = {
  file: string;
  duration: number;
  script: string;
  captions: string[];
  hashtags: string[];
  postCopy: string;
  score: number;
  reason: string;
  width: number;
  height: number;
  format: "9:16" | "16:9";
  visualMode: "pixabay-animation" | "procedural-cartoon";
  visualSources: PixabayAnimationCredit[];
  managerGuidance: CreativeGuidance;
};

type Progress = (percent: number, stage: string) => Promise<unknown>;
type CharacterKind = "dog" | "cat" | "bunny" | "bird" | "bear" | "fox" | "fish";
type Character = { name: string; kind: CharacterKind };
type RunOptions = {
  cwd?: string;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
};

const ffmpeg = process.env.PHOENIX_FFMPEG_PATH?.trim() || path.join(process.cwd(), "node_modules", "@ffmpeg-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = process.env.PHOENIX_FFPROBE_PATH?.trim() || path.join(process.cwd(), "node_modules", "@ffprobe-installer", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const voiceScript = path.join(process.cwd(), "scripts", "synthesize-local-voice.ps1");
const windowsPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const copiedSong = /(baby shark|pinkfong|cocomelon|super simple songs|doo\s+doo\s+doo|wheels on the bus|round and round|twinkle,?\s+twinkle)/i;
const OUTPUT_FPS = KIDS_ANIMATION_FPS;
const MAX_CHILD_LOG_CHARS = 64 * 1024;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function appendLogTail(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString();
  return next.length > MAX_CHILD_LOG_CHARS ? next.slice(-MAX_CHILD_LOG_CHARS) : next;
}

function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true });
    lowerChildProcessPriority(child.pid);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const detail = stderr.trim() || stdout.trim();
      finish(new Error(
        `${path.basename(command)} timed out after ${Math.round((options.timeoutMs || 360_000) / 1000)} seconds.` +
        (detail ? `\n${detail.slice(-2200)}` : "")
      ));
    }, options.timeoutMs || 360_000);
    child.stdout.on("data", (data: Buffer) => {
      stdout = appendLogTail(stdout, data);
      try {
        options.onStdout?.(data.toString());
      } catch (error) {
        child.kill("SIGKILL");
        finish(error instanceof Error ? error : new Error("Local process output handler failed."));
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = appendLogTail(stderr, data);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) =>
      code === 0
        ? finish()
        : finish(new Error(
            (stderr.trim() || stdout.trim()).slice(-2200) || `${path.basename(command)} failed (${code})`
          ))
    );
  });
}

async function mediaDuration(file: string) {
  const raw = await run(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ], { timeoutMs: 30_000 });
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("Could not read local audio/video duration.");
  return value;
}

type MediaProbe = {
  format?: { duration?: string };
  streams?: Array<{
    codec_name?: string;
    codec_type?: string;
    width?: number;
    height?: number;
  }>;
};

async function probeRenderedVideo(file: string) {
  const raw = await run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name,codec_type,width,height",
    "-of", "json",
    file,
  ], { timeoutMs: 30_000 });
  let data: MediaProbe;
  try {
    data = JSON.parse(raw) as MediaProbe;
  } catch {
    throw new Error("FFprobe returned invalid metadata for the rendered children's video.");
  }
  const duration = Number(data.format?.duration);
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0 || !video || !audio) {
    throw new Error("The rendered children's video is missing a valid picture or audio stream.");
  }
  return { duration, video, audio };
}

export async function kidsRendererAvailable(requireModel = true) {
  try {
    await Promise.all([
      fs.access(ffmpeg),
      fs.access(ffprobe),
      fs.access(voiceScript),
      fs.access(windowsPowerShell),
    ]);
    if (!requireModel) return true;
    const writer = readWritingSettings();
    if (writer.provider === "groq") return !!writer.apiKey && writer.freePlanConfirmed;
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function inventKidsIdea(type: "children-story" | "children-song") {
  const characters = [
    "Pip Puppy and Coco Cat",
    "Milo Dog and Luna Kitten",
    "Benny Bunny and Tika Bird",
    "Nori Bear and Poppy Fox",
  ];
  const adventures = type === "children-song"
    ? [
        "Lead the Bouncy Button Parade",
        "Sing the Sparkly Clean-Up Cheer",
        "Dance with the Moonbeam Fireflies",
        "Make a Rainy-Day Rhythm",
      ]
    : [
        "Build a Rainbow Kite Together",
        "Find the Sleepy Garden Star",
        "Rescue a Tiny Moonbeam",
        "Share the Golden Garden Ball",
      ];
  return `${characters[Math.floor(Math.random() * characters.length)]} ${adventures[Math.floor(Math.random() * adventures.length)]}`;
}

const storySeriesBeats = [
  ["The Sparkling Invitation", "follow a surprising invitation and choose a shared goal"],
  ["The First Little Clue", "notice a tiny clue that points them toward the next step"],
  ["The Wobbly Bridge", "cross a wobbly obstacle by listening and taking turns"],
  ["A New Friend Joins", "welcome a shy new friend whose special skill helps the adventure"],
  ["The Plan Goes Sideways", "recover from a funny failed plan without blaming each other"],
  ["The Secret in the Garden", "solve a visual pattern hidden in the garden"],
  ["The Brave Kind Choice", "choose kindness when taking the easier path would leave someone behind"],
  ["One Last Big Problem", "combine everything they learned to face one final safe challenge"],
  ["The Teamwork Solution", "work as a team to complete the goal and help their whole community"],
  ["The Happy Celebration", "celebrate the completed adventure and clearly share what they learned"],
] as const;

export function buildKidsStorySeries(topic: string, count = 10) {
  const base = topic.replace(/\s+/g, " ").trim().slice(0, 220);
  return storySeriesBeats.slice(0, clamp(Math.round(count), 1, storySeriesBeats.length)).map(([title, beat], index) => ({
    topic: `${base} · Part ${index + 1}: ${title}`,
    beat,
    episodeNumber: index + 1,
    episodeCount: Math.min(storySeriesBeats.length, Math.max(1, Math.round(count))),
  }));
}

function cleanModelText(value: string) {
  return value
    .split(String.fromCharCode(96, 96, 96)).join("")
    .replace(/^\s*(story|lyrics?|song)\s*:\s*/i, "")
    .replace(/^\s*(verse|chorus|bridge)\s*\d*\s*:\s*/gim, "")
    .trim();
}

function wordCount(value: string) {
  return value.match(/\b[\p{L}'-]+\b/gu)?.length || 0;
}

export function castFor(topic: string): [Character, Character] {
  if (/benny|bunny|rabbit/i.test(topic) || /tika|bird/i.test(topic)) {
    return [{ name: "Benny", kind: "bunny" }, { name: "Tika", kind: "bird" }];
  }
  if (/nori|bear/i.test(topic) || /poppy|fox/i.test(topic)) {
    return [{ name: "Nori", kind: "bear" }, { name: "Poppy", kind: "fox" }];
  }
  if (/fish|ocean|sea/i.test(topic)) {
    return [{ name: "Finn", kind: "fish" }, { name: "Bubbles", kind: "fish" }];
  }
  if (/milo|luna/i.test(topic)) {
    return [{ name: "Milo", kind: "dog" }, { name: "Luna", kind: "cat" }];
  }
  return [{ name: "Pip", kind: "dog" }, { name: "Coco", kind: "cat" }];
}

function adventureFor(topic: string) {
  return topic
    .replace(/^(Pip Puppy and Coco Cat|Milo Dog and Luna Kitten|Benny Bunny and Tika Bird|Nori Bear and Poppy Fox)\s+/i, "")
    .trim() || "make a kind new adventure";
}

const fallbackEpisodeScenarios = [
  { place: "sunflower gate", discovery: "a silver invitation fluttering under a leaf", obstacle: "a gust sent the invitation over a bubbling stream", helper: "a careful turtle showed them three stepping stones", solution: "tie the blue ribbon between two branches and cross together", payoff: "the gate opened into a lantern picnic" },
  { place: "pebble path", discovery: "three glowing footprints pointing toward a tiny bell", obstacle: "the footprints vanished beside a patch of tall grass", helper: "a shy field mouse noticed the grass bending in a pattern", solution: "follow the bends slowly and ring the bell twice", payoff: "a hidden trail of star-shaped pebbles appeared" },
  { place: "wobbly garden bridge", discovery: "a basket of seeds waiting on the other side", obstacle: "the bridge rocked whenever both friends rushed forward", helper: "a patient frog tapped a slow left-right rhythm", solution: "step one at a time while counting the rhythm aloud", payoff: "they delivered the seeds without spilling one" },
  { place: "blueberry hill", discovery: "a small bird trying to lift a bright red ribbon", obstacle: "the ribbon was caught around a prickly twig", helper: "the bird could see the knot from high above", solution: "listen to the bird's directions and loosen each loop gently", payoff: "their new friend used the ribbon to mark the safe path home" },
  { place: "puddle square", discovery: "a paper windmill meant for the afternoon parade", obstacle: "their first cart rolled straight into a puddle", helper: "a laughing duck showed how wide feet stay above the mud", solution: "build a wider cart from bark and test it slowly", payoff: "the windmill spun brighter after the rain" },
  { place: "whispering garden", discovery: "colored stones humming a quiet tune", obstacle: "the stones stopped humming whenever anyone grabbed them", helper: "a ladybug pointed to matching flowers nearby", solution: "place each stone beside the flower with the same color", payoff: "the stones played a cheerful welcome melody" },
  { place: "acorn lane", discovery: "two lunch boxes beside a torn trail map", obstacle: "the quickest path would leave a tired hedgehog alone", helper: "the hedgehog remembered a safe tunnel under the hill", solution: "share their snacks and take the tunnel together", payoff: "everyone reached the fair before the music began" },
  { place: "moonbeam pond", discovery: "the final clue shining beneath a lily pad", obstacle: "dark clouds covered the moon and hid the clue", helper: "their earlier friends each brought one tiny lantern", solution: "arrange the lanterns in the pattern they had learned", payoff: "the clue revealed a map to their shared goal" },
  { place: "rainbow meadow", discovery: "a giant kite with four loose strings", obstacle: "no single friend could hold every string in the wind", helper: "the whole garden team offered paws, wings, and patient voices", solution: "assign one string to each helper and count down together", payoff: "the kite carried their kind message across the meadow" },
  { place: "lantern garden", discovery: "a blank celebration banner waiting above the path", obstacle: "everyone had a different idea for the final picture", helper: "the shyest friend suggested giving each idea its own little space", solution: "paint one shared scene made from every friend's favorite memory", payoff: "the banner glowed as the whole community danced beneath it" },
] as const;

function fallbackStory(input: KidsRenderInput, guidance: CreativeGuidance) {
  const [first, second] = castFor(input.topic);
  const adventure = (input.episodeBeat || adventureFor(input.seriesTitle || input.topic)).toLowerCase();
  const episodeIndex = clamp((input.episodeNumber || 1) - 1, 0, fallbackEpisodeScenarios.length - 1);
  let scenario: {place:string;discovery:string;obstacle:string;helper:string;solution:string;payoff:string} = fallbackEpisodeScenarios[episodeIndex];
  // A standalone kite/ball/star idea must not silently become the same
  // invitation story. Keep the plot within this renderer's actual prop set.
  if (!input.episodeNumber) {
    if (/kite/i.test(input.topic)) scenario={...scenario,place:"windy garden",discovery:"a rainbow kite with tangled strings",obstacle:"the kite tumbled when the wind pulled the tangled string",solution:"untangle one loop at a time and lift the kite together",payoff:"the rainbow kite rose smoothly above the flowers"};
    else if (/star|moon/i.test(input.topic)) scenario={...scenario,place:"quiet moonlit garden",discovery:"a little star glowing beside a flower",obstacle:"the star grew dim whenever they hurried",solution:"breathe slowly and hold the star gently together",payoff:"the little star glowed brightly above the flowers"};
    else if (/ball/i.test(input.topic)) scenario={...scenario,place:"flower garden",discovery:"a golden ball resting beside the path",obstacle:"the ball rolled away whenever both friends reached at once",solution:"take turns holding and rolling the ball slowly",payoff:"the ball rolled safely from one friend to the other"};
  }
  const sentences = [
    `“Look!” cried ${first.name}, spotting ${scenario.discovery}.`,
    `${first.name} and ${second.name} hurried toward the ${scenario.place}, ready to ${adventure}.`,
    `${second.name} paused to look closely before they moved anything.`,
    `Suddenly, ${scenario.obstacle}.`,
    `${first.name} tried a quick idea, but it made the problem wobble even more.`,
    `Instead of blaming anyone, ${second.name} asked, “What did we notice?”`,
    `They took one calm breath and looked at the shapes, sounds, and colors around them.`,
    `${second.name} noticed a helpful pattern and pointed it out.`,
    `${first.name} listened while ${second.name} repeated the clue in simple words.`,
    `Together they decided to ${scenario.solution}.`,
    `One small step worked, then a second step worked, and both friends began to smile.`,
    `With one final careful try, ${scenario.payoff}.`,
    `They thanked each other and waved in the happy garden.`,
    `${first.name} said, “Your careful thinking helped us.”`,
    `${second.name} answered, “And your brave first step helped us begin.”`,
    "They learned that listening, kindness, and teamwork can turn a tricky surprise into a wonderful adventure.",
  ];
  const essential=new Set([0,1,3,7,9,11,15]);
  const selected=sentences.filter((_,index)=>essential.has(index));
  let words=wordCount(selected.join(' '));
  const budget=Math.max(words,Math.round(input.duration*guidance.wordsPerSecond));
  for (let index=0;index<sentences.length;index++) {
    if (essential.has(index)) continue;
    const count=wordCount(sentences[index]);
    if (words+count<=budget) {essential.add(index);words+=count;}
  }
  return sentences.filter((_,index)=>essential.has(index)).join(" ");
}

function fallbackSong(input: KidsRenderInput) {
  const [first, second] = castFor(input.topic);
  const topic = input.topic.toLowerCase();
  const rainy = /rain|puddle|storm|umbrella/.test(topic);
  const bedtime = /bedtime|sleep|moon|night|firefl/.test(topic);
  const cleanup = /clean|tidy|put away|toy/.test(topic);
  const chorus = rainy
    ? [
        "Drip-drop, clap-clap, listen to the rain.",
        "Hop-hop, flap-flap, dance along the lane.",
        "Share the beat and let each friend belong.",
        "Rainy days can make a bright new song.",
      ]
    : bedtime
      ? [
          "Glow-glow, fireflies, shimmer soft and slow.",
          "Hush-hush, sleepy stars, show us where to go.",
          "Breathe with a friend and hum the gentle tune.",
          "Kind little dreams are dancing with the moon.",
        ]
      : cleanup
        ? [
            "Pick it up, sort it out, every toy has space.",
            "Pass it on, sing along, smiles on every face.",
            "Working with a friend makes every job feel light.",
            "Tidy little helpers make the playroom bright.",
          ]
        : [
            "Clap-clap together, kind hearts lead the way.",
            "Sing-sing together, we help, share, and play.",
            "Move with a friend and let each smile belong.",
            "One team, one happy beat, one brand-new song.",
          ];
  const verses = rainy
    ? [
        ["Tap two toes as raindrops drum the ground.", `${first.name} makes a puddle-splashing sound.`, `${second.name} spreads bright wings and counts to four.`, "One, two, three, four—dance a little more."],
        ["Clouds roll softly over Puddle Square.", `${first.name} twirls a blue umbrella there.`, `${second.name} shakes the silver raindrops free.`, "Shake, shake, shimmer—come and dance with me."],
        ["Big drops say boom; small drops say tip-tap.", "Pat your knees and make a thunder clap.", "If a friend feels nervous, hold them near.", "Count the gentle beat until they cheer."],
        [`${first.name} spots a flower bending low.`, `${second.name} finds a dry place it can grow.`, "Together they carry it out of the rain.", "Kindness makes the garden smile again."],
        ["Wind slows down and clouds begin to part.", "Golden sunshine warms each dancing heart.", "Red and yellow arch across the blue.", "Wave up high—the rainbow waves to you."],
        [`${first.name} drums on buckets, soft then loud.`, `${second.name} sings a melody to the crowd.`, "Every little voice can join the tune.", "We can dance from rainy day to moon."],
        ["Now we march where shiny puddles gleam.", "Every splash becomes a dancing dream.", "Friends take turns and leave room in the line.", "Your own special rhythm fits just fine."],
        ["Raindrops fade; the garden smells brand-new.", `${first.name} bows and ${second.name} bows there too.`, "Keep the kindness beat when skies are gray.", "Carry this happy rhythm through your day."],
      ]
    : bedtime
      ? [
          ["Tiptoe softly as the daylight ends.", `${first.name} waves goodnight to all the friends.`, `${second.name} sees the first small evening star.`, "Shine, little lantern, show us where you are."],
          ["Fireflies are blinking by the tree.", "Count one, two, three, then breathe with me.", "Fold your hands and let your shoulders rest.", "Quiet little breathing helps us feel our best."],
          ["Moonlight paints a silver path below.", `${first.name} hums the notes both friends now know.`, `${second.name} adds a soft and gentle rhyme.`, "Friends can make a peaceful bedtime time."],
          ["If a dream feels wobbly, hold my hand.", "We can name one happy thing we planned.", "Kind words make a cozy place to stay.", "Morning brings another playful day."],
          ["Blankets make a cloud beneath our toes.", "Every busy wing and paw now slows.", "Stars keep watch above the quiet room.", "Flowers rest and wait for morning bloom."],
          ["One last yawn and one last tiny sway.", "Thank the moon for lighting up our way.", "Close your eyes; our gentle song is through.", "Sleep in peace—the night is hugging you."],
          ["Dream of kites and puddles painted gold.", "Dream of friendly stories yet untold.", "Every friend is safe within the tune.", "Kind little dreams are dancing with the moon."],
          [`${first.name} whispers, “See you when it is light.”`, `${second.name} whispers, “Have a lovely night.”`, "Quiet now, the final stars appear.", "Morning and our friends will soon be here."],
        ]
      : cleanup
        ? [
            ["Blocks in the basket, books on the shelf.", `${first.name} starts with one small toy by themself.`, `${second.name} joins in and counts to three.`, "Helping hands make room for you and me."],
            ["Red cars here and blue balls over there.", "Sort each color with a little care.", "Pass one toy and say a cheerful please.", "Teamwork makes the busiest clean-up easy."],
            ["Shake out the blanket, fold it left and right.", "Line the crayons up from dark to light.", "Check beneath the table, check the chair.", "Every little helper does a share."],
            ["When a job feels big, begin with one.", "Finish one small corner, then it is fun.", "Ask a friend and listen to their plan.", "Side by side, we do the best we can."],
            ["Now the floor is open for a dance.", "Every tidy toy gets one more chance.", "Tomorrow we can find our games with ease.", "Cleaning up together is a breeze."],
            ["Pencils in the cup and paints away.", "Save the special picture we made today.", "Wash our hands and take a happy bow.", "Look how bright the playroom feels right now."],
            ["Check the labels, match each shape and name.", "Putting things in place can be a game.", "Slow and steady keeps the pieces neat.", "One last tidy step completes the beat."],
            [`${first.name} cheers and ${second.name} rings the bell.`, "Every friend has helped the room look well.", "Now we know the clean-up words to say.", "Pick it up together every day."],
          ]
        : [
            ["Step to the left, then bounce to the right.", "Wave to a friend and make the morning bright.", "Tap both your shoulders, then wiggle your toes.", "Make a big circle and follow where it goes."],
            [`${first.name} finds a rhythm; ${second.name} finds a beat.`, "Fireflies are sparkling near their dancing feet.", "Tiptoe very softly, then reach up to the sky.", "Turn around slowly as the moonbeams flutter by."],
            ["If a friend feels worried, offer them your hand.", "Every voice is welcome in our friendly little band.", "Pat your knees twice, then make one joyful sound.", "Smile at everybody as we dance around the ground."],
            ["March like a tiny bear, strong but never loud.", "Flutter like a little bird above the laughing crowd.", "Swim like a silver fish and hop like a bunny too.", "Choose your favorite movement; make it special just for you."],
            ["Count one bright footstep, then count two and three.", "Four kind helping hands are reaching happily.", "Five small stars are blinking while we learn the tune.", "Six soft bedtime wishes float beside the moon."],
            ["Pause and hear the quiet; listen for a friend.", "Ask what they are feeling, and stay until the end.", "Try a smaller action when a giant plan feels wrong.", "Patient little choices help our team grow strong."],
            ["Now the drums are bouncing, and the colors start to shine.", "Move a little faster while we follow every sign.", "Hands up for teamwork; hands down for a rest.", "Helping one another is the move we love the best."],
            [`${first.name} calls, “Are you ready?” ${second.name} calls, “Yes!”`, "Everybody answers with their brightest, bravest best.", "We finish our adventure, but the kindness carries on.", "Take this happy rhythm everywhere when we are gone."],
          ];
  const bridge = rainy
    ? ["Music gets quiet; hear the raindrops slow.", "Breathe in gently; watch the flowers grow.", "Whisper our kindness promise, soft and strong.", "Then bring back the beat and sing along."]
    : bedtime
      ? ["Music gets quiet; breathe in, then breathe out.", "Let the sleepy silence wrap itself about.", "Whisper one kind wish beneath the silver light.", "Then hum our chorus softly to the night."]
      : cleanup
        ? ["Music gets quiet; look around once more.", "Is there one small puzzle hiding on the floor?", "Find its cozy home, then ring the clean-up bell.", "Bring the beat back proudly—we have done it well."]
        : ["Music gets quiet; breathe in, then breathe out.", "Think of one kind thing that you can do about.", "Whisper it gently, then say it clear and strong.", "Now bring the beat back and sing the chorus song."];
  const verseCount = clamp(Math.round(input.duration / 25), 1, verses.length);
  const middle = Math.max(1, Math.floor(verseCount / 2));
  const arranged = [
    `${first.name} taps two toes; ${second.name} claps along.`,
    "Come join the rhythm; everybody sing our song.",
  ];
  for (let index = 0; index < verseCount; index++) {
    arranged.push(...verses[index], ...chorus);
    if (index + 1 === middle && verseCount > 2) {
      arranged.push(...bridge);
    }
  }
  arranged.push(`${first.name} and ${second.name} take a final bow.`, "One last clap for friendship—thank you, friends, for now.");
  return arranged.join("\n");
}

function topicTerms(topic: string) {
  const stop = new Set(["and", "the", "with", "from", "into", "dog", "cat", "puppy", "kitten", "song", "story"]);
  return (topic.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((word) => !stop.has(word));
}

function isRelevant(script: string, topic: string) {
  const terms = [...new Set(topicTerms(topic))];
  if (!terms.length) return true;
  const lower = script.toLowerCase();
  const hits = terms.filter((term) => lower.includes(term)).length;
  return hits >= Math.min(2, terms.length);
}

function followsEpisodeBeat(script: string, input: KidsRenderInput) {
  return !input.episodeBeat || isRelevant(script, input.episodeBeat);
}

export async function createContent(input: KidsRenderInput, guidance: CreativeGuidance) {
  if (input.scriptApproved || input.scriptLocked) {
    if (!input.script?.trim()) throw new Error("The approved narration is empty. Reopen the draft.");
    return input.script.trim();
  }
  // Uploaded song lyrics must remain verbatim; rewriting them makes the
  // subtitles unrelated to the actual singing in the recording.
  if (input.creationType === "children-song" && input.songAudioId) return (input.script || "").trim();
  const targetWords = clamp(Math.round(input.duration * guidance.wordsPerSecond), 40, 500);
  const supplied = cleanModelText(input.script || "");
  const suppliedWords = wordCount(supplied);
  if (
    supplied &&
    !copiedSong.test(supplied) &&
    isRelevant(supplied, input.topic) &&
    followsEpisodeBeat(supplied, input) &&
    suppliedWords >= Math.max(30, Math.round(targetWords * 0.5)) &&
    suppliedWords <= Math.round(targetWords * 1.55)
  ) return supplied;

  // Small local language models often force rhymes into ungrammatical phrases
  // and repeat filler for long songs. Phoenix's reviewed theme composer gives
  // every song a reliable verse/chorus/bridge structure while remaining fully
  // original, topic-aware, local, and deterministic.
  if (input.creationType === "children-song") return fallbackSong(input);

  // A ten-part series must stay coherent from episode to episode.  The local
  // 3B model previously wandered away from the requested beat and produced
  // awkward phrases in later parts, so series episodes use the reviewed
  // scenario composer below.  Each part still has its own place, problem,
  // helper, solution, and ending while the recurring cast remains stable.
  if (input.episodeNumber) return fallbackStory(input,guidance);

  const sentenceCount = clamp(Math.round(input.duration / 5), 5, 42);
  const format = `a complete warm story in about ${sentenceCount} short sentences with a beginning, small problem, kind solution, and happy ending`;
  const seriesDirection = input.episodeNumber && input.episodeCount
    ? ` This is part ${input.episodeNumber} of ${input.episodeCount} in the original series "${input.seriesTitle || input.topic}". Its unique episode focus is: ${input.episodeBeat || input.topic}. Make this part understandable by itself, give it a distinct mini-conflict and resolution, and keep the recurring characters consistent without repeating another episode's plot.`
    : "";
  const prompt = `Write only ${format} for children ages 3 to 6 about: "${input.topic}". Aim for ${targetWords} words.${seriesDirection} Name and consistently use the characters and adventure in the idea. Open with action in the first sentence. Use plain grammatical prose, not poetry or forced rhyme. Keep it safe, visual, playful, and easy to narrate. Use only the two main animal characters. This is a limited 2D renderer: use visible actions such as hop, clap, wave, walk, reach, or rest with flowers, stars, ball, kite, drum, toys, bridge or bus. Never copy, name, paraphrase, or imitate an existing franchise or character. No headings, notes, or explanation. Production improvements from owner ratings: ${guidance.rules.join(' ') || 'Use clear visual cause and effect and a specific ending.'}`;
  try {
    const response = await generateWritingModel({
        model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
        prompt,
        options: { temperature: 0.35, num_predict: Math.min(1100, Math.ceil(targetWords * 2.15) + 80), num_thread: 2, num_ctx: 4096 },
      }, { timeoutMs: 120_000 });
    const data = (await response.json()) as { response?: string };
    const text = cleanModelText(String(data.response || ""));
    const words = wordCount(text);
    if (
      response.ok &&
      words >= Math.round(targetWords * 0.65) &&
      words <= Math.round(targetWords * 1.55) &&
      !copiedSong.test(text) &&
      isRelevant(text, input.topic) &&
      followsEpisodeBeat(text, input)
    ) return text;
  } catch (error) {
    if (isWritingWaitError(error) || isWritingConfigurationError(error) || writingModelIdentity().startsWith("groq:")) throw error;
    // The topic-specific local fallback below keeps the job useful and offline.
  }
  if (writingModelIdentity().startsWith("groq:")) throw new Error("The Groq story did not pass length, topic or episode checks. Retry the saved job; no unrelated replacement story was used.");
  return fallbackStory(input,guidance);
}

function captionChunks(script: string, type: KidsRenderInput["creationType"], requestedMaximum=10) {
  const units = type === "children-song"
    ? script.split(/\r?\n/)
    : script.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  const maximumWords = Math.max(5,Math.min(type === "children-song" ? 10 : 12,requestedMaximum));
  const maximumCharacters = type === "children-song" ? 62 : 70;
  for (const raw of units) {
    const clean = raw.replace(/^\s*(?:[-*#]+|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const words = clean.split(/\s+/).filter(Boolean);
    const unitChunks: string[][] = [];
    let current: string[] = [];
    for (const word of words) {
      const candidate = [...current, word].join(" ");
      if (current.length && (current.length >= maximumWords || candidate.length > maximumCharacters)) {
        unitChunks.push(current);
        current = [word];
      } else {
        current.push(word);
      }
    }
    if (current.length) unitChunks.push(current);
    const last = unitChunks.at(-1);
    const previous = unitChunks.at(-2);
    while (last && previous && last.length < 3 && previous.length > 4) {
      last.unshift(previous.pop() as string);
    }
    chunks.push(...unitChunks.map((wordsInChunk) => wordsInChunk.join(" ")));
  }
  return chunks;
}


function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scaleFrequency(tonic: number, degree: number, octaveShift = 0) {
  const majorScale = [0, 2, 4, 5, 7, 9, 11];
  const octave = Math.floor(degree / majorScale.length);
  const normalized = ((degree % majorScale.length) + majorScale.length) % majorScale.length;
  return tonic * 2 ** ((majorScale[normalized] + (octave + octaveShift) * 12) / 12);
}

function seededNoise(state: number) {
  let next = state || 0x6d2b79f5;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return { state: next >>> 0, value: ((next >>> 0) / 0xffffffff) * 2 - 1 };
}

function melodyWav(durationSeconds: number, song: boolean, topic = "Phoenix local melody") {
  const rate = 44_100;
  const samples = Math.ceil(durationSeconds * rate);
  const data = Buffer.alloc(samples * 2);
  const seed = stableHash(`${topic}|${song ? "song" : "story"}`);
  const tonicChoices = [196, 220, 233.08, 246.94, 261.63];
  const tonic = tonicChoices[seed % tonicChoices.length];
  const progressions = [
    [0, 4, 5, 3],
    [0, 3, 4, 0],
    [0, 5, 3, 4],
  ];
  const progression = progressions[(seed >>> 5) % progressions.length];
  const motifBase = [0, 2, 4, 2, 1, 3, 4, 2, 0, 2, 5, 4, 3, 1, 2, 0];
  const motif = motifBase.map((degree, index) =>
    (degree + ((seed >>> ((index % 8) * 3)) & 1)) % 7
  );
  const bpm = song ? 104 + (seed % 5) * 4 : 72 + (seed % 4) * 3;
  const beatSeconds = 60 / bpm;
  let noiseState = seed;

  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const beatPosition = time / beatSeconds;
    const beatIndex = Math.floor(beatPosition);
    const beatPhase = beatPosition - beatIndex;
    const barIndex = Math.floor(beatPosition / 4);
    const chordDegree = progression[barIndex % progression.length];
    const fade = Math.min(1, time / 1.2, Math.max(0, (durationSeconds - time) / 1.8));
    let value: number;

    if (song) {
      // A repeating 28-bar form gives the song audible intro, verse, chorus,
      // bridge and final-chorus dynamics without using external samples.
      const formBar = barIndex % 28;
      const energy = formBar < 4 ? 0.55 : formBar < 12 ? 0.78 : formBar < 20 ? 1 : formBar < 24 ? 0.62 : 1.08;
      const chordRoot = scaleFrequency(tonic, chordDegree, -1);
      const chordThird = scaleFrequency(tonic, chordDegree + 2, -1);
      const chordFifth = scaleFrequency(tonic, chordDegree + 4, -1);
      const padPulse = 0.72 + 0.28 * Math.sin(2 * Math.PI * time / (beatSeconds * 4));
      const pad = (
        Math.sin(2 * Math.PI * chordRoot * time) +
        Math.sin(2 * Math.PI * chordThird * time) * 0.75 +
        Math.sin(2 * Math.PI * chordFifth * time) * 0.62
      ) * 0.036 * padPulse;

      const bassEnvelope = Math.min(1, beatPhase / 0.05) * Math.max(0, 1 - beatPhase * 0.92);
      const bass = Math.sin(2 * Math.PI * (chordRoot / 2) * time) * bassEnvelope * 0.13;

      const halfBeatPosition = beatPosition * 2;
      const halfBeatIndex = Math.floor(halfBeatPosition);
      const notePhase = halfBeatPosition - halfBeatIndex;
      const motifDegree = motif[halfBeatIndex % motif.length] + (formBar >= 12 && formBar < 20 ? 7 : 0);
      const leadFrequency = scaleFrequency(tonic, motifDegree, 0);
      const leadEnvelope = Math.min(1, notePhase / 0.09) * Math.max(0, 1 - notePhase * 0.88);
      const lead = (
        Math.sin(2 * Math.PI * leadFrequency * time) +
        Math.sin(4 * Math.PI * leadFrequency * time) * 0.22
      ) * leadEnvelope * (formBar < 4 ? 0.045 : 0.082);

      const beatInBar = beatIndex % 4;
      const kickAge = beatPhase * beatSeconds;
      const kick = (beatInBar === 0 || beatInBar === 2) && kickAge < 0.22
        ? Math.sin(2 * Math.PI * (92 * kickAge - 105 * kickAge * kickAge)) * Math.exp(-kickAge * 17) * 0.24
        : 0;
      const random = seededNoise(noiseState);
      noiseState = random.state;
      const snare = (beatInBar === 1 || beatInBar === 3) && kickAge < 0.16
        ? random.value * Math.exp(-kickAge * 25) * 0.13
        : 0;
      const halfBeatAge = notePhase * beatSeconds / 2;
      const hat = halfBeatAge < 0.045 ? random.value * Math.exp(-halfBeatAge * 72) * 0.045 : 0;
      const chorusClap = formBar >= 12 && formBar < 20 && (beatInBar === 1 || beatInBar === 3) && kickAge < 0.08
        ? random.value * Math.exp(-kickAge * 34) * 0.055
        : 0;
      value = Math.tanh((pad + bass + lead + kick + snare + hat + chorusClap) * energy * 1.3) * 0.72;
    } else {
      const noteDuration = beatSeconds * 2;
      const noteIndex = Math.floor(time / noteDuration);
      const notePhase = (time % noteDuration) / noteDuration;
      const note = scaleFrequency(tonic, motif[noteIndex % motif.length], -1);
      const envelope = Math.min(1, notePhase / 0.08) * Math.max(0, 1 - notePhase * 0.55);
      const softChord = Math.sin(2 * Math.PI * note * time) * 0.09 + Math.sin(Math.PI * note * time) * 0.03;
      value = softChord * envelope;
    }
    data.writeInt16LE(clamp(Math.round(value * fade * 32767), -32767, 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function localMusicWav(durationSeconds: number, energetic = false) {
  return melodyWav(durationSeconds, energetic);
}

function timestamp(seconds: number) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

type CaptionCue = { text: string; start: number; end: number; duration: number };

/** Word-weighted estimates, not forced alignment to spoken or sung words. */
export function kidsCaptionCues(captions: string[], seconds: number): CaptionCue[] {
  if (!captions.length) throw new Error("The local script did not contain any usable caption text.");
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Caption timing needs a positive measured video duration.");
  const usableSeconds = seconds;
  const weights = captions.map((caption) => Math.max(2, wordCount(caption)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const minimum = Math.min(1.35, (usableSeconds / captions.length) * 0.72);
  const flexibleSeconds = Math.max(0, usableSeconds - minimum * captions.length);
  let cursor = 0;
  return captions.map((text, index) => {
    const duration = minimum + (flexibleSeconds * weights[index]) / total;
    const end = index === captions.length - 1 ? seconds : cursor + duration;
    const cue = { text, start: cursor, end, duration: end - cursor };
    cursor = end;
    return cue;
  });
}

function makeSrt(cues: CaptionCue[]) {
  return cues.map((cue, index) =>
    `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`
  ).join("\n");
}

function assTimestamp(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const secs = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function makeAss(cues: CaptionCue[], width: number, height: number) {
  const fontSize = height > width ? 42 : 36;
  const verticalMargin = height > width ? 76 : 38;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00152A3A,&H90000000,-1,0,0,0,100,100,0,0,3,2,0,8,42,42,${verticalMargin},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
  const events = cues.map((cue) => {
    const text = cue.text.replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
    return `Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Caption,,0,0,0,,${text}`;
  }).join("\n");
  return `${header}${events}\n`;
}

function hashtags(input: KidsRenderInput) {
  const stop = new Set(["and", "the", "with", "from", "into"]);
  const topic = (input.topic.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((word) => word.length > 2 && !stop.has(word))
    .slice(0, 4)
    .map((word) => `#${word[0].toUpperCase()}${word.slice(1)}`);
  return [...new Set([
    "#KidsVideo",
    input.creationType === "children-song" ? "#KidsSong" : "#KidsStory",
    "#Ages3To6",
    "#OriginalKidsContent",
    ...topic,
  ])].slice(0, 9);
}

export function boundedNarrationTempo(sourceSeconds: number, targetSeconds: number) {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds <= 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error("Narration timing needs valid measured audio and target durations.");
  }
  const factor = sourceSeconds / targetSeconds;
  if (factor < 0.92 - 1e-9 || factor > 1.08 + 1e-9) {
    throw new Error(`Narration lasts ${sourceSeconds.toFixed(1)} seconds but the video requests ${targetSeconds.toFixed(1)} seconds. ` +
      `That needs a ${Math.abs(factor - 1) * 100 > 0 ? (Math.abs(factor - 1) * 100).toFixed(1) : "0"}% tempo change; Phoenix allows at most 8% to protect the voice and ending. ` +
      `Choose a duration near ${Math.round(sourceSeconds)} seconds or ${factor > 1 ? "shorten" : "expand"} the script, then retry. Your script and recorded narration are retained.`);
  }
  return `atempo=${factor.toFixed(5)}`;
}

/** Duration follows measured speech within the chosen publishing range. */
export function kidsNarrationTiming(input: Pick<KidsRenderInput, "duration" | "creationType" | "aspect" | "publishingFormat" | "targetPlatform">, sourceSeconds: number) {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds <= 0 || !Number.isFinite(input.duration) || input.duration <= 0) {
    throw new Error("Narration timing needs valid measured audio and target durations.");
  }
  if (input.creationType === "children-song") {
    return { targetSeconds: input.duration, tempoFactor: 1, decision: "requested-song-excerpt" as const };
  }
  const profile = publishingProfile(inferPublishingFormat(input));
  // Legacy/direct render callers can request lengths outside today's creation
  // profiles. Keep their explicit contract rather than silently reclassify them.
  const inProfile = input.duration >= profile.minDuration && input.duration <= profile.maxDuration;
  const targetSeconds = inProfile ? clamp(sourceSeconds, profile.minDuration, profile.maxDuration) : input.duration;
  try {
    boundedNarrationTempo(sourceSeconds, targetSeconds);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : "Narration cannot fit naturally."}${inProfile ? ` ${profile.label} needs ${profile.minDuration}–${profile.maxDuration} seconds; revise the script to that range before retrying.` : ""}`);
  }
  return {
    targetSeconds,
    tempoFactor: sourceSeconds / targetSeconds,
    decision: Math.abs(sourceSeconds - targetSeconds) < 1e-9 ? "measured-narration" as const : "bounded-profile-correction" as const,
  };
}

/** Uses the recording unchanged in time; story correction is deliberately small. */
export function kidsAudioFilter(narrationSeconds: number, targetSeconds: number, song: boolean) {
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error("Audio timing needs valid measured audio and target durations.");
  }
  if (song) {
    if (narrationSeconds + 0.15 < targetSeconds) throw new Error("The sung recording is shorter than the video. Choose a video duration within the recording; songs are not stretched or replaced with spoken lyrics.");
    return `[1:a]atrim=duration=${targetSeconds},asetpts=N/SR/TB,loudnorm=I=-16:LRA=9:TP=-1.5[a]`;
  }
  const tempo = boundedNarrationTempo(narrationSeconds, targetSeconds);
  return `[1:a]${tempo},apad,atrim=duration=${targetSeconds},asetpts=N/SR/TB,loudnorm=I=-15:LRA=7:TP=-1.5,apad[n];` +
    `[2:a]atrim=duration=${targetSeconds},asetpts=N/SR/TB,loudnorm=I=-29:LRA=10:TP=-2,apad[m];` +
    // Bundled FFmpeg can discard a short loudnorm branch when amix observes its
    // EOF during buffered-sample flushing. Post-normalization padding keeps both
    // branches alive; the explicit mixed trim bounds their lifetime and output.
    `[n][m]amix=inputs=2:duration=longest,atrim=duration=${targetSeconds},alimiter=limit=0.95,loudnorm=I=-16:LRA=9:TP=-1,atrim=duration=${targetSeconds}[a]`;
}

function clockSeconds(value: string) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : Number.NaN;
}

function ffmpegProgressReporter(targetSeconds: number, onProgress: Progress, start = 58, end = 91) {
  let buffer = "";
  let lastPercent = start;
  let latestSeconds = 0;
  let reports = Promise.resolve<unknown>(undefined);

  const report = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    latestSeconds = clamp(seconds, latestSeconds, targetSeconds);
    const percent = clamp(start + Math.floor((latestSeconds / targetSeconds) * (end - start)), start, end);
    if (percent <= lastPercent) return;
    lastPercent = percent;
    reports = reports.then(() => onProgress(
      percent,
      `Rendering locally · ${latestSeconds.toFixed(1)}s of ${targetSeconds}s encoded`
    ));
  };

  const line = (raw: string) => {
    const separator = raw.indexOf("=");
    if (separator < 0) return;
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    // This 2018 FFmpeg labels microseconds as out_time_ms. Newer builds may also
    // expose out_time_us, so both deliberately use the same conversion here.
    if (key === "out_time_ms" || key === "out_time_us") report(Number(value) / 1_000_000);
    else if (key === "out_time") report(clockSeconds(value));
    else if (key === "progress" && value === "end") report(targetSeconds);
  };

  return {
    accept(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      if (buffer.length > 8192) buffer = buffer.slice(-8192);
      for (const value of lines) line(value);
    },
    async finish(completed = true) {
      if (buffer) line(buffer);
      if (completed) report(targetSeconds);
      await reports;
    },
  };
}

export async function renderKidsVideo(
  id: string,
  input: KidsRenderInput,
  onProgress: Progress
): Promise<KidsRenderResult> {
  if (!Number.isFinite(input.duration) || input.duration < 20 || input.duration > 210) {
    throw new Error("Children's video duration must be between 20 and 210 seconds.");
  }
  if (!input.topic.trim()) throw new Error("A topic is required for a children's video.");
  if (input.creationType === "children-song") {
    await requireSongAudio(input.songAudioId, input.duration);
    if (!input.script?.trim()) throw new Error("Add the lyrics from the sung recording.");
  }
  if (!(await kidsRendererAvailable(input.creationType !== "children-song" && !input.script?.trim()))) {
    throw new Error("The children renderer is unavailable. Check the selected writer, FFmpeg and Windows local voice in Studio health.");
  }

  const requestedSeconds = input.duration;
  const format = input.aspect || "9:16";
  // Compose both orientations natively, then export at 720p to preserve detail
  // without making this laptop encode a needless 1080p image.
  const width = format === "9:16" ? 720 : 1280;
  const height = format === "9:16" ? 1280 : 720;
  const directory = path.join(reviewRoot(), "work", `kids-${id}`);
  const output = path.join(directory, "final.mp4");
  await fs.mkdir(directory, { recursive: true });
  await fs.rm(output, { force: true });

  const managerGuidance=await getCreativeGuidance(input.creationType);
  await fs.writeFile(path.join(directory,"manager-guidance.json"),JSON.stringify(managerGuidance,null,2),"utf8");
  await onProgress(8, input.songAudioId ? "Preparing your recorded song lyrics" : `Planning a story with ${managerGuidance.feedbackCount} owner reviews`);
  const script = await createContent(input,managerGuidance);
  if (!input.songAudioId && copiedSong.test(script)) throw new Error("The local script safety check rejected copied lyrics.");
  if (!input.songAudioId && !isRelevant(script, input.topic)) throw new Error("The generated script did not match the selected idea.");
  if (!followsEpisodeBeat(script, input)) throw new Error("The generated script did not follow this episode's distinct story beat.");
  const captions = captionChunks(script, input.creationType,managerGuidance.maxCaptionWords);
  const song = input.creationType === "children-song";
  if (input.sceneNarration?.length && input.sceneNarration.join(" ").replace(/\s+/g, " ") !== script.replace(/\s+/g, " ")) throw new Error("The approved visual scenes do not match the narration. Reopen the draft.");
  await fs.writeFile(path.join(directory, "narration.txt"), script, "utf8");

  await onProgress(24, song ? "Preparing the supplied sung recording at its original pitch" : "Creating a friendly local narration");
  const narration = path.join(directory, "narration.wav");
  const voiceArgs = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", voiceScript,
    "-TextFile", path.join(directory, "narration.txt"),
    "-OutputFile", narration,
    "-Rate", "0",
  ];
  if (input.voice && input.voice !== "local-windows-voice") voiceArgs.push("-Voice", input.voice);
  const voiceTimeoutMs = clamp(Math.ceil(60_000 + requestedSeconds * 750), 90_000, 300_000);
  try {
    if (song) {
      await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...FFMPEG_FILTER_RESOURCE_ARGS, "-threads", "1", "-i", songAudioPath(input.songAudioId!), "-t", String(requestedSeconds), "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", narration], { timeoutMs: voiceTimeoutMs });
    } else await run(windowsPowerShell, voiceArgs, { timeoutMs: voiceTimeoutMs });
  } catch (error) {
    throw new Error(`${song ? "Song audio preparation" : "Windows local voice synthesis"} failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const narrationSeconds = await mediaDuration(narration);
  const timing = kidsNarrationTiming(input, narrationSeconds);
  const targetSeconds = timing.targetSeconds;
  // Fail before drawing frames if speech cannot fit naturally. Never spend a
  // full render hiding an extreme tempo correction or a cut-off ending.
  const audioFilter = kidsAudioFilter(narrationSeconds, targetSeconds, song);
  // Establish caption and animation timing only after measuring the voice.
  // There is no invented intro gap; word timing remains explicitly estimated.
  const cues = kidsCaptionCues(captions, targetSeconds);
  const visualCues = input.sceneNarration?.length ? kidsCaptionCues(input.sceneNarration, targetSeconds) : cues;
  if (cues.some((cue) => cue.duration < 0.85)) {
    throw new Error("The script is too dense to display as readable captions alongside the measured narration. Shorten the script or use fewer caption breaks and retry; the narration is retained.");
  }
  await onProgress(29, song ? "Keeping the supplied singing at its original speed" : `Timing scenes around ${targetSeconds.toFixed(1)} seconds of measured narration`);
  await fs.writeFile(path.join(directory, "audio-timing.json"), JSON.stringify({
    sourceSeconds: narrationSeconds, requestedSeconds, ...timing,
    captionTiming: "estimated-word-weighted", captionStartSeconds: 0,
    note: "Captions follow proportional word timing, not measured word alignment; review against the audio before posting.",
  }, null, 2), "utf8");

  let animationBackground: Awaited<ReturnType<typeof preparePixabayAnimationBackground>> = null;
  try {
    // Original scenery is the coherent default. An explicitly configured stock
    // background remains available without changing any character actions.
    if (process.env.PHOENIX_KIDS_STOCK_BACKGROUNDS === "1") {
    animationBackground = await preparePixabayAnimationBackground({
      topic: input.topic,
      directory,
      format,
      onStage: async (stage) => onProgress(33, stage),
    });
    }
  } catch (error) {
    console.warn("[kids-renderer] Pixabay animation fallback", error instanceof Error ? error.message : error);
  }

  await onProgress(
    38,
    animationBackground
      ? `Animating character actions over licensed scenery for ${captions.length} caption beats`
      : `Animating character actions and matching props for ${captions.length} caption beats`,
  );
  const cast = castFor(input.topic);
  let animationPercent = 38;
  await prepareKidsAnimation({
    directory, topic: input.topic, cues: visualCues, duration: targetSeconds, aspect: format,
    cast: [cast[0].kind, cast[1].kind], castNames: [cast[0].name, cast[1].name], song, transparent: !!animationBackground,
    onProgress: async (value) => {
      const percent = 38 + Math.floor(value * 0.17);
      if (percent <= animationPercent) return;
      animationPercent = percent;
      await onProgress(percent, `Drawing moving arms, feet, faces, and props · ${value}%`);
    },
  });
  await fs.writeFile(path.join(directory, "captions.srt"), makeSrt(cues), "utf8");
  await fs.writeFile(path.join(directory, "captions.ass"), makeAss(cues, width, height), "utf8");
  await fs.writeFile(path.join(directory, "captions.json"), JSON.stringify(cues, null, 2), "utf8");
  await fs.writeFile(
    path.join(directory, "music.wav"),
    melodyWav(targetSeconds, song, input.topic)
  );

  await onProgress(58, `Animating ${animationBackground ? "licensed backgrounds and original characters" : "original scenes"}, mixing clear audio, and burning captions`);
  // The ASS file declares the exact render dimensions, font size, and top-safe
  // placement so captions cannot drift over the recurring characters.
  const subtitle = "subtitles=captions.ass";
  const picture = animationBackground
    ? `[3:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${width}:${height},fps=${OUTPUT_FPS},trim=duration=${targetSeconds},setpts=PTS-STARTPTS[bg];` +
      `[0:v]scale=${width}:${height}:flags=fast_bilinear,fps=${OUTPUT_FPS},format=rgba[fg];[bg][fg]overlay=0:0:shortest=1`
    : `[0:v]scale=${width}:${height}:flags=fast_bilinear`;
  const filter = `${picture},setsar=1,fps=${OUTPUT_FPS},trim=duration=${targetSeconds},setpts=PTS-STARTPTS[v];` + audioFilter;
  const renderProgress = ffmpegProgressReporter(targetSeconds, onProgress, 58, 82);
  const renderTimeoutMs = clamp(Math.ceil(targetSeconds * 3_500), 360_000, 900_000);
  try {
    const ffmpegArgs = [
      "-hide_banner", "-loglevel", "warning", ...FFMPEG_FILTER_RESOURCE_ARGS,
      "-nostats", "-progress", "pipe:1",
      "-y", "-threads", "1", "-f", "concat", "-safe", "0", "-i", "scenes.txt",
      "-i", "narration.wav", "-i", "music.wav",
    ];
    if (animationBackground) ffmpegArgs.push("-stream_loop", "-1", "-i", animationBackground.file);
    ffmpegArgs.push(
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]", "-t", String(targetSeconds),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", ...FFMPEG_ENCODER_RESOURCE_ARGS, "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "clean.mp4",
    );
    await run(ffmpeg, ffmpegArgs, { cwd: directory, timeoutMs: renderTimeoutMs, onStdout: renderProgress.accept });
  } catch (error) {
    await renderProgress.finish(false).catch(() => undefined);
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error(`Bundled FFmpeg could not complete the children's video: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  try {
    await renderProgress.finish();
  } catch (error) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error(`The video encoded, but render progress could not be saved: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  await onProgress(83, "Saving the editable clean master and burning readable captions");
  const captionProgress = ffmpegProgressReporter(targetSeconds, onProgress, 83, 91);
  try {
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "warning", ...FFMPEG_FILTER_RESOURCE_ARGS,
      "-nostats", "-progress", "pipe:1", "-y", "-threads", "1", "-i", "clean.mp4",
      "-vf", subtitle, "-t", String(targetSeconds), "-c:v", "libx264",
      "-preset", "ultrafast", "-crf", "23", ...FFMPEG_ENCODER_RESOURCE_ARGS,
      "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "final.mp4",
    ], { cwd: directory, timeoutMs: renderTimeoutMs, onStdout: captionProgress.accept });
    await captionProgress.finish();
  } catch (error) {
    await captionProgress.finish(false).catch(() => undefined);
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error(`Caption export failed; the clean master is retained for manual editing: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  await onProgress(92, "Checking duration, picture, audio, captions, and topic match");
  let rendered: Awaited<ReturnType<typeof probeRenderedVideo>>;
  try {
    rendered = await probeRenderedVideo(output);
  } catch (error) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw error;
  }
  const finalDuration = rendered.duration;
  if (Math.abs(finalDuration - targetSeconds) > 0.12) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error(`Final video is ${finalDuration.toFixed(3)}s; the measured audio timeline requires ${targetSeconds.toFixed(3)}s.`);
  }
  if (rendered.video.width !== width || rendered.video.height !== height) {
    await fs.rm(output, { force: true }).catch(() => undefined);
    throw new Error(
      `Final picture is ${rendered.video.width || 0}x${rendered.video.height || 0}; expected ${width}x${height}.`
    );
  }
  const textCheck=checkKidsScript(captions,targetSeconds,song);
  const visualDescription = animationBackground
    ? `${animationBackground.credits.length} licensed moving Pixabay scenery backgrounds with articulated original characters`
    : "original 2D animation with moving limbs, expressions, and caption-matched action props";
  const reason = `${textCheck.reason} Render: ${visualDescription}, ${finalDuration.toFixed(1)}-second ${rendered.video.codec_name}/${rendered.audio.codec_name} MP4. ${song ? "Uses supplied audio at its original pitch and speed. " : ""}Caption timings are word-weighted estimates, not measured word alignment; check them against the audio. Needs your visual and listening review.`;
  return {
    file: output,
    duration: finalDuration,
    script,
    captions,
    hashtags: hashtags(input),
    postCopy: `${input.topic} — ${input.creationType === "children-song" ? input.songMode === "local-ace" ? "an original locally generated animated song" : "an animated song using your recording" : "an original short story"} for children ages 3–6.`,
    score: textCheck.score,
    reason,
    width,
    height,
    format,
    visualMode: animationBackground ? "pixabay-animation" : "procedural-cartoon",
    visualSources: animationBackground?.credits || [],
    managerGuidance,
  };
}

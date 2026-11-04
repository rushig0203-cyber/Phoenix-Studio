const beats = [
  { en: "Krishna lifted a clay butter pot.", hi: "कृष्ण ने मिट्टी की मटकी उठाई।", action: "lift", actor: 0 },
  { en: "The heavy butter pot wobbled in Krishna's hands.", hi: "कृष्ण के हाथों में मक्खन की मटकी डगमगाई।", action: "wobble", actor: 0 },
  { en: "Meera watched the pot and reached out to help.", hi: "मीरा ने मटकी देखी और हाथ बढ़ाया।", action: "notice", actor: 1 },
  { en: "Krishna passed the butter pot to Meera with care.", hi: "कृष्ण ने धीरे से मटकी मीरा को थमा दी।", action: "offer", actor: 0 },
  { en: "Meera held the pot steady.", hi: "मीरा ने मटकी संभाली।", action: "hold", actor: 1 },
  { en: "Meera set the butter pot down on the courtyard floor.", hi: "मीरा ने मटकी आँगन की ज़मीन पर रख दी।", action: "lower", actor: 1 },
  { en: "Krishna smiled at Meera as the pot stopped wobbling.", hi: "मटकी थम गई और कृष्ण मीरा को देखकर मुस्कुराए।", action: "smile", actor: 0 },
  { en: "They smiled beside the steady pot, ready to share.", hi: "दोनों ने मटकी के पास मुस्कुराकर मक्खन बाँटने की सोची।", action: "rest", actor: 1 },
] as const;

export const KRISHNA_STORY_TITLE = "Krishna and the Butter Pot";
export const HINDI_KRISHNA_STORY_TITLE = "कृष्ण और मक्खन की मटकी";
export const isKrishnaStoryTopic = (topic: string) => /^(?:krishna(?: 2d| and the butter pot)?|कृष्ण(?: 2d| और मक्खन की मटकी)?)$/iu.test(topic.trim());

export function krishnaStoryPreset(topic: string, language?: string) {
  if (!isKrishnaStoryTopic(topic)) return null;
  const hindi = /कृष्ण/u.test(topic) || /^(?:hi|hindi)(?:-|$)/i.test(language || "");
  const scenes = beats.map(beat => hindi ? beat.hi : beat.en);
  return { scenes, script: scenes.join(" "), language: hindi ? "Hindi" : "English" };
}

export const krishnaStoryCue = (text: string) => beats.find(beat => beat.en === text || beat.hi === text);

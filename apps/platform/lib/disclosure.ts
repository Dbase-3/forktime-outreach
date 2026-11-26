// Every caller must hear that it's an AI assistant and that the call is
// recorded (product rule). This checks a welcome message for both, in the
// languages agents can speak (bug B9: the old check was English-only and
// replaced a correct Spanish greeting). It checks fixed text the owner wrote,
// not anything a caller says. Pure.

const AI = [
  /\bA\.?I\.?\b/i, // English, and "AI" used inside most other languages
  /\bIA\b/, // Spanish, French, Italian, Portuguese
  /\bKI\b/, // German
  /inteligencia artificial|intelligence artificielle|künstliche intelligenz|intelligenza artificiale|inteligência artificial/i,
  /एआई|कृत्रिम बुद्धि/, // Hindi
  /الذكاء الاصطناعي/, // Arabic
  /人工智能|智能助手/, // Mandarin
];

const RECORDED = [
  /\brecord/i, // English: recorded, recording
  /\bgrab(a|ad|aci|ando)/i, // Spanish: se graba, grabada, grabación
  /enregistr/i, // French
  /aufgezeichnet|aufgenommen|aufzeichnung/i, // German
  /registrat|registrazione/i, // Italian
  /gravad|gravação|gravando/i, // Portuguese
  /रिकॉर्ड/, // Hindi
  /تسجيل|مسجل/, // Arabic
  /录音|录制/, // Mandarin
];

export function greetingIsHonest(greeting: string): boolean {
  return AI.some((re) => re.test(greeting)) && RECORDED.some((re) => re.test(greeting));
}

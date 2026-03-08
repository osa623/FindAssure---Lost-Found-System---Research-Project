import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini AI - will be set when first used if API key exists
let genAI: GoogleGenerativeAI | null = null;

/**
 * Get or initialize the Gemini AI instance
 */
const getGeminiAI = (): GoogleGenerativeAI | null => {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      console.warn('⚠️  GEMINI_API_KEY not configured or using placeholder');
      return null;
    }
    try {
      genAI = new GoogleGenerativeAI(apiKey);
      console.log('✅ Gemini AI initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Gemini AI:', error);
      return null;
    }
  }
  return genAI;
};

interface GenerateQuestionsInput {
  category: string;
  description: string;
}

interface GenerateSuggestedAnswersInput {
  category: string;
  description: string;
  questions: string[];
}

type KnowledgeBaseCategory =
  | 'wallet'
  | 'handbag'
  | 'backpack'
  | 'laptop'
  | 'smartphone'
  | 'helmet'
  | 'key'
  | 'power_bank'
  | 'charger_cable'
  | 'earbuds'
  | 'headphones'
  | 'student_id'
  | 'generic';

type KnowledgeBaseTemplate = {
  question: string;
  cues?: string[];
};

const CATEGORY_ALIASES: Record<KnowledgeBaseCategory, string[]> = {
  wallet: ['wallet', 'billfold', 'pocket wallet'],
  handbag: ['handbag', 'bag', 'purse', 'tote', 'shoulder bag', 'ladies bag'],
  backpack: ['backpack', 'school bag', 'rucksack', 'knapsack'],
  laptop: ['laptop', 'notebook', 'macbook'],
  smartphone: ['smartphone', 'phone', 'mobile', 'iphone', 'android phone'],
  helmet: ['helmet', 'bike helmet', 'motorcycle helmet'],
  key: ['key', 'keys', 'keychain', 'key ring', 'fob'],
  power_bank: ['power bank', 'powerbank', 'portable charger', 'battery pack'],
  charger_cable: ['charger', 'charging cable', 'cable', 'wire', 'usb cable', 'adapter'],
  earbuds: ['earbuds', 'airpods', 'in-ear', 'ear buds', 'wireless buds'],
  headphones: ['headphones', 'headset', 'over-ear', 'on-ear'],
  student_id: ['student id', 'id card', 'id', 'campus card', 'student card', 'identity card'],
  generic: [],
};

const QUESTION_KNOWLEDGE_BASE: Record<KnowledgeBaseCategory, KnowledgeBaseTemplate[]> = {
  wallet: [
    { question: 'What is the wallet color?' },
    { question: 'What material does it have?' },
    { question: 'What brand name is visible?', cues: ['brand', 'logo'] },
    { question: 'How many card slots are there?', cues: ['card', 'slot'] },
    { question: 'How many cards are inside?', cues: ['card', 'id', 'bank'] },
    { question: 'Which bank name appears on a card?', cues: ['bank', 'card', 'visa', 'master'] },
    { question: 'Is there an ID card inside?', cues: ['id', 'card'] },
    { question: 'Is there a coin zip pocket?', cues: ['zip', 'coin'] },
    { question: 'Any scratch or tear visible?', cues: ['scratch', 'tear', 'damage', 'crack'] },
    { question: 'Any sticker or mark visible?', cues: ['sticker', 'mark', 'initial'] },
    { question: 'Is there a hidden pocket inside?', cues: ['hidden', 'inside', 'compartment'] },
    { question: 'What is the fold style?', cues: ['bifold', 'trifold', 'fold'] },
  ],
  handbag: [
    { question: 'What is the bag color?' },
    { question: 'What type is this bag?' },
    { question: 'What brand logo is visible?', cues: ['brand', 'logo'] },
    { question: 'How many main compartments are there?', cues: ['compartment', 'section'] },
    { question: 'How many zip pockets are visible?', cues: ['zip', 'pocket'] },
    { question: 'What is the strap style?', cues: ['strap', 'handle'] },
    { question: 'Any keychain or charm attached?', cues: ['keychain', 'charm', 'tag'] },
    { question: 'Any visible stain or scratch?', cues: ['stain', 'scratch', 'mark', 'damage'] },
    { question: 'What lining color is inside?', cues: ['inside', 'lining', 'inner'] },
    { question: 'Any unique print or pattern?', cues: ['pattern', 'print', 'design'] },
    { question: 'Is there a side pocket?', cues: ['side', 'pocket'] },
    { question: 'Any initials or name tag visible?', cues: ['initial', 'name', 'tag'] },
  ],
  backpack: [
    { question: 'What is the backpack color?' },
    { question: 'What brand is on the bag?', cues: ['brand', 'logo'] },
    { question: 'How many compartments are there?', cues: ['compartment', 'section'] },
    { question: 'How many zip lines are visible?', cues: ['zip', 'zipper'] },
    { question: 'Any bottle holder on sides?', cues: ['bottle', 'side pocket', 'side'] },
    { question: 'Any keychain or tag attached?', cues: ['keychain', 'tag', 'charm'] },
    { question: 'Any name label visible?', cues: ['name', 'label', 'tag'] },
    { question: 'Any tear or scratch visible?', cues: ['tear', 'scratch', 'damage'] },
    { question: 'What is inside the main compartment?', cues: ['inside', 'book', 'laptop', 'item'] },
    { question: 'Any unique patch or sticker?', cues: ['patch', 'sticker', 'mark'] },
    { question: 'What color are the zips?', cues: ['zip', 'zipper'] },
    { question: 'Is the bottom padded or plain?', cues: ['bottom', 'pad'] },
  ],
  laptop: [
    { question: 'What is the laptop brand?' },
    { question: 'What is the laptop color?' },
    { question: 'What screen size is it?' },
    { question: 'Any sticker on the lid?', cues: ['sticker', 'logo', 'lid'] },
    { question: 'Any crack or dent visible?', cues: ['crack', 'dent', 'scratch', 'damage'] },
    { question: 'What keyboard backlight color?', cues: ['keyboard', 'backlight'] },
    { question: 'What wallpaper is on lock screen?', cues: ['wallpaper', 'screen'] },
    { question: 'What is the login name shown?', cues: ['login', 'user', 'name'] },
    { question: 'How many USB ports are visible?', cues: ['usb', 'port', 'hdmi'] },
    { question: 'Is charger included with it?', cues: ['charger', 'adapter'] },
    { question: 'Any engraving or asset tag visible?', cues: ['asset', 'tag', 'engraving'] },
    { question: 'What hinge color is visible?', cues: ['hinge'] },
  ],
  smartphone: [
    { question: 'What is the phone brand?' },
    { question: 'What is the phone color?' },
    { question: 'What model series is it?' },
    { question: 'How many rear cameras are there?', cues: ['camera', 'lens'] },
    { question: 'Is there a phone case on it?', cues: ['case', 'cover'] },
    { question: 'What color is the phone case?', cues: ['case', 'cover'] },
    { question: 'Any crack on screen glass?', cues: ['crack', 'screen', 'damage'] },
    { question: 'What lock screen wallpaper is shown?', cues: ['wallpaper', 'lock screen'] },
    { question: 'Any sticker or mark on back?', cues: ['sticker', 'mark', 'scratch'] },
    { question: 'What is the SIM tray side?', cues: ['sim', 'tray'] },
    { question: 'Any custom ringtone or alert tone?', cues: ['ringtone', 'alert', 'tone'] },
    { question: 'What language is on lock screen?', cues: ['language', 'screen'] },
  ],
  helmet: [
    { question: 'What is the helmet color?' },
    { question: 'Is it full face or open face?' },
    { question: 'What brand logo is visible?', cues: ['brand', 'logo'] },
    { question: 'Any sticker or custom decal?', cues: ['sticker', 'decal', 'mark'] },
    { question: 'Any scratch or crack visible?', cues: ['scratch', 'crack', 'damage'] },
    { question: 'What color is the visor?', cues: ['visor', 'glass'] },
    { question: 'Is the visor clear or tinted?', cues: ['visor', 'tinted', 'clear'] },
    { question: 'Any name or initials inside?', cues: ['name', 'initial', 'inside'] },
    { question: 'What strap buckle type is there?', cues: ['strap', 'buckle'] },
    { question: 'Any vent switch visible?', cues: ['vent', 'switch'] },
    { question: 'What size mark is inside?', cues: ['size', 'inside'] },
    { question: 'Any padding color visible?', cues: ['padding', 'inside'] },
  ],
  key: [
    { question: 'How many keys are on ring?' },
    { question: 'What color is the keychain?', cues: ['keychain', 'tag', 'ring'] },
    { question: 'Any remote fob attached?', cues: ['fob', 'remote'] },
    { question: 'What brand is on remote?', cues: ['brand', 'fob', 'remote'] },
    { question: 'Any tag text on keychain?', cues: ['tag', 'label', 'text'] },
    { question: 'Any unique key shape visible?', cues: ['shape', 'cut', 'pattern'] },
    { question: 'Any broken or bent key?', cues: ['broken', 'bent', 'damage'] },
    { question: 'Any number engraved on key?', cues: ['number', 'engraved', 'code'] },
    { question: 'Is there a bottle opener tag?', cues: ['opener', 'tag', 'tool'] },
    { question: 'Any small charm attached?', cues: ['charm', 'tag'] },
    { question: 'What metal color are keys?', cues: ['metal', 'color'] },
    { question: 'Any plastic key cover color?', cues: ['cover', 'cap'] },
  ],
  power_bank: [
    { question: 'What is the power bank color?' },
    { question: 'What brand is printed on it?' },
    { question: 'What capacity is written on it?', cues: ['mah', 'capacity'] },
    { question: 'How many output ports are there?', cues: ['port', 'usb'] },
    { question: 'Is there a display or lights?', cues: ['display', 'light', 'indicator'] },
    { question: 'Any scratch or dent visible?', cues: ['scratch', 'dent', 'damage'] },
    { question: 'Any sticker or name label?', cues: ['sticker', 'label', 'name'] },
    { question: 'Is a cable attached to it?', cues: ['cable', 'wire', 'attached'] },
    { question: 'What button shape is on side?', cues: ['button', 'side'] },
    { question: 'Any protective cover on it?', cues: ['cover', 'case'] },
    { question: 'What is the body finish type?', cues: ['matte', 'glossy', 'finish'] },
    { question: 'Any charging level showing now?', cues: ['level', 'indicator', 'display'] },
  ],
  charger_cable: [
    { question: 'Is it cable or charger head?' },
    { question: 'What color is the cable?' },
    { question: 'Which connector type is it?', cues: ['usb-c', 'type c', 'lightning', 'micro usb'] },
    { question: 'What is the cable length?', cues: ['length', 'long', 'short'] },
    { question: 'Any brand name on adapter?', cues: ['brand', 'adapter'] },
    { question: 'Any tape or repair marks?', cues: ['tape', 'repair', 'mark'] },
    { question: 'Any bend near connector?', cues: ['bend', 'damage', 'connector'] },
    { question: 'Is there fast charge label?', cues: ['fast', 'watt', 'pd', 'qc'] },
    { question: 'Any serial text visible?', cues: ['serial', 'text', 'code'] },
    { question: 'Is the adapter pin type two or three?', cues: ['pin', 'plug'] },
    { question: 'Any cable organizer attached?', cues: ['organizer', 'clip', 'tie'] },
    { question: 'Any unique stain or mark?', cues: ['stain', 'mark', 'spot'] },
  ],
  earbuds: [
    { question: 'What brand are the earbuds?' },
    { question: 'What color are the earbuds?' },
    { question: 'Is there a charging case?', cues: ['case', 'box'] },
    { question: 'What color is the case?', cues: ['case'] },
    { question: 'Any scratch on case lid?', cues: ['scratch', 'lid', 'damage'] },
    { question: 'Any engraving or sticker on case?', cues: ['engraving', 'sticker', 'name'] },
    { question: 'Is one bud missing?', cues: ['missing', 'single'] },
    { question: 'What shape is the case?', cues: ['shape', 'round', 'square'] },
    { question: 'Any silicone tip color visible?', cues: ['tip', 'silicone'] },
    { question: 'Any pairing name you set?', cues: ['pairing', 'bluetooth', 'name'] },
    { question: 'Any charging light color now?', cues: ['light', 'indicator'] },
    { question: 'Any protective case cover used?', cues: ['cover', 'case'] },
  ],
  headphones: [
    { question: 'What brand are the headphones?' },
    { question: 'What color are the headphones?' },
    { question: 'Are they wired or wireless?' },
    { question: 'Any logo on ear cups?', cues: ['logo', 'cup'] },
    { question: 'Any scratch on headband?', cues: ['scratch', 'headband', 'damage'] },
    { question: 'Any padding tear visible?', cues: ['padding', 'tear', 'ear cushion'] },
    { question: 'Is one side louder normally?', cues: ['side', 'sound', 'issue'] },
    { question: 'Any sticker or name mark?', cues: ['sticker', 'name', 'mark'] },
    { question: 'Any folding hinge visible?', cues: ['fold', 'hinge'] },
    { question: 'What port type is for charging?', cues: ['port', 'charging', 'usb-c', 'micro usb'] },
    { question: 'Any carrying pouch with it?', cues: ['pouch', 'case'] },
    { question: 'Any button layout you remember?', cues: ['button', 'control'] },
  ],
  student_id: [
    { question: 'What is the card primary color?' },
    { question: 'Which institute name is printed?' },
    { question: 'What is the card holder name?' },
    { question: 'What are the last four ID digits?', cues: ['id', 'number', 'digits'] },
    { question: 'Is there a photo on front?', cues: ['photo', 'front'] },
    { question: 'What color is the lanyard?', cues: ['lanyard', 'strap'] },
    { question: 'Any department name on card?', cues: ['department', 'faculty'] },
    { question: 'Any visible stamp or seal?', cues: ['stamp', 'seal'] },
    { question: 'Any chip or barcode visible?', cues: ['chip', 'barcode', 'qr'] },
    { question: 'Any crack or bend on card?', cues: ['crack', 'bend', 'damage'] },
    { question: 'Is expiry year visible?', cues: ['expiry', 'year'] },
    { question: 'Any holder text behind card?', cues: ['back', 'text', 'instruction'] },
  ],
  generic: [
    { question: 'What is the item color?' },
    { question: 'What brand name is visible?' },
    { question: 'What material does it look like?' },
    { question: 'Any unique scratch or mark?' },
    { question: 'Any sticker or tag attached?' },
    { question: 'What size does it seem?' },
    { question: 'Any number or code visible?' },
    { question: 'Any special feature you noticed?' },
    { question: 'What part looks most unique?' },
    { question: 'Is any accessory attached?' },
    { question: 'Any visible damage or wear?' },
    { question: 'Any text printed on item?' },
  ],
};

const DESCRIPTION_DYNAMIC_TEMPLATES: KnowledgeBaseTemplate[] = [
  { question: 'What brand logo is visible?', cues: ['brand', 'logo', 'apple', 'samsung', 'hp', 'dell', 'asus', 'lenovo', 'sony', 'jbl', 'boat', 'anker'] },
  { question: 'What color is the item body?', cues: ['black', 'white', 'blue', 'red', 'green', 'silver', 'gold', 'pink', 'brown', 'gray', 'grey'] },
  { question: 'Any crack location visible?', cues: ['crack', 'broken', 'shattered'] },
  { question: 'Any scratch or dent position?', cues: ['scratch', 'dent', 'damage'] },
  { question: 'Any sticker text visible?', cues: ['sticker', 'label'] },
  { question: 'What pattern or print is visible?', cues: ['pattern', 'print', 'design', 'stripe', 'floral'] },
  { question: 'Any keychain or tag attached?', cues: ['keychain', 'tag', 'charm'] },
  { question: 'How many compartments are visible?', cues: ['compartment', 'pocket', 'zip'] },
  { question: 'What connector type is visible?', cues: ['usb-c', 'type c', 'micro usb', 'lightning', 'pin'] },
  { question: 'Any number digits visible?', cues: ['number', 'digit', 'serial', 'imei', 'id'] },
];

const tokenizeText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const detectKnowledgeBaseCategory = (category: string, description: string): KnowledgeBaseCategory => {
  const mergedText = `${category} ${description}`.toLowerCase();

  for (const [kbCategory, aliases] of Object.entries(CATEGORY_ALIASES) as Array<
    [KnowledgeBaseCategory, string[]]
  >) {
    if (kbCategory === 'generic') continue;
    if (aliases.some((alias) => mergedText.includes(alias))) {
      return kbCategory;
    }
  }

  return 'generic';
};

const buildKnowledgeBaseQuestions = (
  category: string,
  description: string,
  targetCount = 10
): string[] => {
  const normalizedCategory = detectKnowledgeBaseCategory(category, description);
  const descriptionTokens = tokenizeText(description);
  const descriptionSet = new Set(descriptionTokens);
  const categoryTemplates = QUESTION_KNOWLEDGE_BASE[normalizedCategory] || QUESTION_KNOWLEDGE_BASE.generic;

  const scoredTemplates = categoryTemplates.map((template) => {
    const cues = template.cues || [];
    const cueHits = cues.reduce((count, cue) => {
      const cueParts = tokenizeText(cue);
      const matched = cueParts.every((part) => descriptionSet.has(part) || description.toLowerCase().includes(part));
      return count + (matched ? 1 : 0);
    }, 0);
    return { template, cueHits };
  });

  scoredTemplates.sort((a, b) => b.cueHits - a.cueHits);
  const dynamicTemplates = DESCRIPTION_DYNAMIC_TEMPLATES.filter((template) =>
    (template.cues || []).some((cue) => description.toLowerCase().includes(cue.toLowerCase()))
  );

  const ordered = [...scoredTemplates.map((x) => x.template), ...dynamicTemplates, ...QUESTION_KNOWLEDGE_BASE.generic];
  const uniqueQuestions: string[] = [];
  const seen = new Set<string>();

  for (const item of ordered) {
    const question = item.question.trim();
    const normalized = question.toLowerCase();
    if (!question || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueQuestions.push(question);
    if (uniqueQuestions.length >= targetCount) break;
  }

  if (uniqueQuestions.length < targetCount) {
    const genericPool = QUESTION_KNOWLEDGE_BASE.generic.map((t) => t.question);
    for (const question of genericPool) {
      const normalized = question.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueQuestions.push(question);
      if (uniqueQuestions.length >= targetCount) break;
    }
  }

  return uniqueQuestions.slice(0, targetCount);
};

const CATEGORY_SPECIFIC_PROMPTS: Record<KnowledgeBaseCategory, string> = {
  wallet: `Wallet Prompt:
- Ask about inside details first.
- Must include card COUNT + card TYPES/BANK names.
- Include hidden pocket/coin zip/fold type.
- Include 1 secure prompt on partial number/text (never full).`,
  handbag: `Handbag/Purse/Tote Prompt:
- Ask compartment and zip pocket count.
- Ask lining color and strap/handle style.
- Ask attached charm/tag/keychain.
- Include at least 1 question about specific inside item type.`,
  backpack: `Backpack Prompt:
- Ask compartment count, zip count, side bottle holder.
- Ask tag/name label and unique patch/sticker.
- Ask about what item type is inside main compartment.
- Include one secure inspectable mark/damage question.`,
  laptop: `Laptop Prompt:
- Ask brand, color, visible stickers/dents.
- Ask lock wallpaper/login-name style clues.
- Ask port count/type and charger details.
- Include one secure owner-known setup detail.`,
  smartphone: `Smartphone Prompt:
- Ask brand/model/color and rear camera count.
- Ask case presence/color and crack/damage location.
- Ask lock-screen wallpaper.
- Include one secure owner-known detail (app layout/ringtone/language).`,
  helmet: `Helmet Prompt:
- Ask helmet type (full/open), visor type/color.
- Ask strap buckle style and inside size mark.
- Ask scratch/decal/sticker features.
- Include one inside padding/initial detail.`,
  key: `Keys Prompt:
- Start with total key count.
- Ask keychain/fob/tag details and brand on fob.
- Ask engraved code/shape (partial only).
- No positional wording like first/second key.`,
  power_bank: `Power Bank Prompt:
- Ask brand, body color, written capacity.
- Ask output port count and indicator/display type.
- Ask stickers/name labels and attached cable.
- Include one secure detail only careful owner knows.`,
  charger_cable: `Charger/Cable Prompt:
- Ask cable vs adapter head, connector type, length, color.
- Ask plug pin type and watt/fast-charge mark.
- Ask bends/tape/repair marks near connector.
- Include one printed text/code partial detail.`,
  earbuds: `Earbuds Prompt:
- Ask brand/color and charging-case presence.
- Ask case color/shape and lid scratches.
- Ask if one bud is missing and tip color/type.
- Include pairing-name style secure clue.`,
  headphones: `Headphones Prompt:
- Ask brand/color and wired vs wireless.
- Ask ear-cup logo and headband/padding condition.
- Ask charging/audio port type and pouch/case.
- Include one owner-known usage detail.`,
  student_id: `Student ID Prompt:
- Ask institute name and card holder name.
- Ask last 4 digits only (never full number).
- Ask department/faculty text and lanyard color.
- Ask visible stamp/seal/chip/barcode clues.`,
  generic: `Generic Prompt:
- Ask clear observable facts: color, brand, mark, attachment.
- Ask one count-based question and one partial text/number question.
- Ask one secure detail only careful owner would know.`,
};

const DISALLOWED_QUESTION_PATTERNS: RegExp[] = [
  /\bwhere\b.*\blose|lost\b/i,
  /\bwhen\b.*\blose|lost\b/i,
  /\bhow do you feel\b/i,
  /\bwhy\b/i,
  /\bfirst\b|\bsecond\b|\bthird\b|\btop\b|\bbottom\b|\bleft\b|\bright\b/i,
];

const MIN_SECURE_KEYWORD_MATCHES = 2;

const secureKeywordsByCategory: Record<KnowledgeBaseCategory, string[]> = {
  wallet: ['inside', 'card', 'bank', 'hidden', 'slot'],
  handbag: ['inside', 'compartment', 'zip', 'lining', 'tag'],
  backpack: ['inside', 'compartment', 'zip', 'tag', 'label'],
  laptop: ['wallpaper', 'login', 'port', 'keyboard', 'sticker'],
  smartphone: ['wallpaper', 'case', 'camera', 'lock', 'app'],
  helmet: ['visor', 'strap', 'padding', 'size', 'decal'],
  key: ['how many', 'keychain', 'fob', 'engraved', 'tag'],
  power_bank: ['capacity', 'port', 'indicator', 'display', 'sticker'],
  charger_cable: ['connector', 'length', 'pin', 'adapter', 'repair'],
  earbuds: ['case', 'pairing', 'missing', 'lid', 'tip'],
  headphones: ['wired', 'wireless', 'port', 'headband', 'padding'],
  student_id: ['last four', 'institute', 'department', 'lanyard', 'holder'],
  generic: ['mark', 'sticker', 'number', 'attachment', 'feature'],
};

const buildGeminiPrompt = (category: string, description: string): string => {
  const kbCategory = detectKnowledgeBaseCategory(category, description);
  const categoryPrompt = CATEGORY_SPECIFIC_PROMPTS[kbCategory];

  return `You are a prompt-optimized verifier for a lost-and-found system in Sri Lanka.
Generate EXACTLY 10 ownership-confirmation questions in SIMPLE English.

Item Category: ${category}
Item Description: ${description}
Detected Category Intent: ${kbCategory}

Goal:
- Questions must help verify true ownership.
- Both founder and owner will answer each question.
- Founder can inspect the item closely; owner knows private details.
- Prefer short-answer prompts (expected answer: 3-4 words, one-word only if unavoidable).

Category-specific prompt to follow strictly:
${categoryPrompt}

Required mix (exactly 10 total):
1. 4 questions about visible/core details from description
2. 4 questions about deeper inspectable details founder can check (inside/attachments/counts/marks)
3. 2 secure questions only true owner likely knows (partial sensitive details only)

Strict rules:
- Ask one clear fact per question.
- Avoid open-ended narrative questions.
- Avoid time/place/history questions (no "where lost", "when lost", "why").
- Avoid ambiguous position words: first/second/top/bottom/left/right.
- Avoid yes/no style questions; use descriptive phrasing.
- For multiple similar objects, ask TOTAL COUNT then TYPE/NAME.
- If IDs/numbers are asked, request partial only (e.g., last 4 digits).
- Keep each question answerable in 5 seconds.

Return ONLY valid JSON array of 10 strings, no extra text.
Example format:
["Question 1?", "Question 2?", "..."]`;
};

const cleanQuestions = (questions: string[]): string[] => {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const raw of questions) {
    const q = raw.trim().replace(/^\d+[\.\)]\s*/, '');
    if (!q) continue;
    const normalized = q.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(q.endsWith('?') ? q : `${q}?`);
  }

  return cleaned;
};

const rewriteBinaryQuestion = (question: string): string => {
  const q = question.trim().replace(/\?+$/, '');
  let m = q.match(/^is there\s+(?:an?\s+|any\s+)?(.+)$/i);
  if (m) return `What ${m[1]} is visible?`;

  m = q.match(/^are there\s+(?:an?\s+|any\s+)?(.+)$/i);
  if (m) return `What ${m[1]} are visible?`;

  m = q.match(/^is it\s+(.+)$/i);
  if (m) return `What ${m[1]} is visible?`;

  m = q.match(/^are they\s+(.+)$/i);
  if (m) return `What ${m[1]} are they?`;

  return question.endsWith('?') ? question : `${question}?`;
};

const normalizeQuestionsForPhraseAnswers = (questions: string[]): string[] =>
  questions.map((q) => rewriteBinaryQuestion(q.trim()));

const passesGeminiQualityGate = (questions: string[], category: string, description: string): boolean => {
  if (!Array.isArray(questions) || questions.length !== 10) return false;
  if (questions.some((q) => DISALLOWED_QUESTION_PATTERNS.some((rx) => rx.test(q)))) return false;

  const kbCategory = detectKnowledgeBaseCategory(category, description);
  const secureKeywords = secureKeywordsByCategory[kbCategory] || secureKeywordsByCategory.generic;
  const secureMatches = questions.filter((q) =>
    secureKeywords.some((k) => q.toLowerCase().includes(k))
  ).length;

  return secureMatches >= MIN_SECURE_KEYWORD_MATCHES;
};

/**
 * Generate verification questions using Gemini AI
 * @param category - Item category (e.g., Electronics, Clothing, etc.)
 * @param description - Item description provided by the founder
 * @returns Array of 10 verification questions
 */
export const generateVerificationQuestions = async ({
  category,
  description,
}: GenerateQuestionsInput): Promise<string[]> => {
  try {
    // Validate input
    if (!category || !description) {
      throw new Error('Category and description are required');
    }

    // Get or initialize Gemini AI instance
    const ai = getGeminiAI();
    if (!ai) {
      console.warn('GEMINI_API_KEY not configured, using fallback questions');
      return getFallbackQuestions(category, description);
    }

    // Get the Gemini 2.5 Flash model
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Create the prompt for question generation
    const prompt = buildGeminiPrompt(category, description);

    // Generate content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Parse the response
    let questions: string[];
    
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, try to parse the whole response
        questions = JSON.parse(text);
      }

      questions = normalizeQuestionsForPhraseAnswers(cleanQuestions(questions));

      // Validate the response
      if (!passesGeminiQualityGate(questions, category, description)) {
        console.warn('Invalid response format from Gemini, using fallback questions');
        return getFallbackQuestions(category, description);
      }

      return questions;
    } catch (parseError) {
      console.error('Error parsing Gemini response:', parseError);
      console.log('Raw response:', text);
      return getFallbackQuestions(category, description);
    }
  } catch (error) {
    console.error('Error generating questions with Gemini:', error);
    // Return fallback questions if AI generation fails
    return getFallbackQuestions(category, description);
  }
};

const COLOR_WORDS = [
  'black', 'white', 'blue', 'red', 'green', 'silver', 'gold', 'pink', 'brown', 'gray', 'grey', 'yellow', 'orange', 'purple'
];
const BRAND_WORDS = [
  'apple', 'samsung', 'huawei', 'xiaomi', 'oneplus', 'nokia', 'sony', 'jbl', 'boat', 'anker',
  'hp', 'dell', 'asus', 'lenovo', 'acer', 'msi', 'commercial bank', 'sampath', 'hnb', 'boc'
];
const MATERIAL_WORDS = ['leather', 'plastic', 'metal', 'fabric', 'cloth', 'rubber', 'silicone', 'canvas'];

const sanitizeAnswerPhrase = (value: string): string => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ').filter(Boolean).slice(0, 4);
  if (words.length === 0) return '';
  if (words.length === 1 && words[0] === 'unknown') return '';
  return words.join(' ');
};

const findFirstWordMatch = (text: string, dictionary: string[]): string | null => {
  const lower = text.toLowerCase();
  for (const item of dictionary) {
    if (lower.includes(item)) return item;
  }
  return null;
};

const NEGATIVE_ANSWER_PATTERNS: RegExp[] = [
  /\bnot\b.*\bvisible\b/i,
  /\bunclear\b/i,
  /\bunknown\b/i,
  /\bnot sure\b/i,
  /\bcannot\b/i,
  /\bcan\'t\b/i,
  /\bdon\'t know\b/i,
];

const normalizeSuggestedAnswer = (answer: string): string => {
  const sanitized = sanitizeAnswerPhrase(answer);
  if (NEGATIVE_ANSWER_PATTERNS.some((rx) => rx.test(sanitized))) {
    return '';
  }
  return sanitized;
};

const ensureThreeToFourWordPhrase = (answer: string, question: string): string => {
  const sanitized = sanitizeAnswerPhrase(answer);
  if (!sanitized) return '';

  const words = sanitized.split(' ').filter(Boolean);
  if (words.length >= 3) return words.slice(0, 4).join(' ');

  const q = question.toLowerCase();
  const joined = words.join(' ');

  if (q.includes('color')) return `${joined} color tone`.split(' ').slice(0, 4).join(' ');
  if (q.includes('brand') || q.includes('logo')) return `${joined} brand logo`.split(' ').slice(0, 4).join(' ');
  if (q.includes('how many') || q.includes('count') || q.includes('number')) return `${joined} items total`;
  if (q.includes('material')) return `${joined} material finish`;
  if (q.includes('fold')) return `${joined} fold type`;

  return `${joined} detail noted`.split(' ').slice(0, 4).join(' ');
};

const inferAnswerFromDescription = (question: string, description: string): string | null => {
  const q = question.toLowerCase();
  const d = description.toLowerCase();

  if (q.includes('how many') || q.includes('count') || q.includes('number')) {
    const num = d.match(/\b\d+\b/)?.[0];
    if (num) return `${num} items total`;
  }

  if (q.includes('color')) {
    const color = findFirstWordMatch(d, COLOR_WORDS);
    if (color) return `${color} color tone`;
  }

  if (q.includes('brand') || q.includes('logo') || q.includes('model')) {
    const brand = findFirstWordMatch(d, BRAND_WORDS);
    if (brand) return `${brand} brand logo`;
  }

  if (q.includes('material') || q.includes('made')) {
    const material = findFirstWordMatch(d, MATERIAL_WORDS);
    if (material) return `${material} material finish`;
  }

  if (q.includes('fold')) {
    if (d.includes('bifold')) return 'bifold fold style';
    if (d.includes('trifold')) return 'trifold fold style';
    if (d.includes('fold')) return 'fold type noted';
    return null;
  }

  if (q.includes('crack') || q.includes('scratch') || q.includes('dent') || q.includes('damage')) {
    if (d.includes('crack') || d.includes('broken')) return 'screen crack visible';
    if (d.includes('scratch')) return 'minor scratches visible';
    return null;
  }

  if (q.includes('inside') || q.includes('compartment') || q.includes('pocket') || q.includes('slot')) {
    if (d.includes('card')) return 'cards kept inside';
    if (d.includes('key')) return 'keys kept inside';
    if (d.includes('charger')) return 'charger kept inside';
    if (d.includes('pocket') || d.includes('compartment') || d.includes('inside')) return 'inner section noted';
    return null;
  }

  if (q.includes('wallpaper') || q.includes('login') || q.includes('ringtone') || q.includes('pairing name')) {
    return null;
  }

  if ((q.startsWith('is there') || q.startsWith('are there')) && d.length > 0) {
    const keyTokens = tokenizeText(q).filter((t) => t.length > 2 && !['there', 'what', 'which'].includes(t));
    if (keyTokens.some((t) => d.includes(t))) {
      return 'yes clearly visible';
    }
  }

  return null;
};

const buildFallbackFounderAnswers = (questions: string[], description: string): string[] =>
  questions.map((q) => {
    const inferred = inferAnswerFromDescription(q, description);
    return inferred ? ensureThreeToFourWordPhrase(inferred, q) : '';
  });

const isAnswerGroundedInDescription = (answer: string, description: string): boolean => {
  const a = answer.toLowerCase().trim();
  const d = description.toLowerCase();
  if (!a) return false;
  if (a === 'yes' || a === 'no') return true;
  const answerTokens = tokenizeText(a).filter((t) => t.length > 2);
  if (answerTokens.length === 0) return false;
  return answerTokens.some((token) => d.includes(token));
};

const parseGeminiAnswers = (text: string): string[] | null => {
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const payload = jsonMatch ? jsonMatch[0] : text;
    const answers = JSON.parse(payload);
    if (!Array.isArray(answers)) return null;
    return answers.map((a) => sanitizeAnswerPhrase(String(a)));
  } catch {
    return null;
  }
};

export const generateSuggestedFounderAnswers = async ({
  category,
  description,
  questions,
}: GenerateSuggestedAnswersInput): Promise<string[]> => {
  if (!questions.length) return [];

  const fallbackAnswers = buildFallbackFounderAnswers(questions, description);
  const ai = getGeminiAI();
  if (!ai) return fallbackAnswers;

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You assist a founder in a lost-and-found workflow.
Generate one short suggested answer for each question.

Category: ${category}
Description: ${description}
Questions: ${JSON.stringify(questions)}

Rules:
- Return ONLY JSON array of strings in same order and same length as questions.
- Each answer should be 3-4 words whenever possible.
- Keep answers factual and inspectable.
- If description does not contain enough info for a question, return empty string "".
- Never invent or guess details.
- Do not add explanations.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const parsed = parseGeminiAnswers(text);

    if (!parsed || parsed.length !== questions.length) {
      return fallbackAnswers;
    }

    return parsed.map((ans, index) => {
      const normalized = ensureThreeToFourWordPhrase(normalizeSuggestedAnswer(ans), questions[index]);
      if (normalized && isAnswerGroundedInDescription(normalized, description)) {
        return normalized;
      }
      const inferred = inferAnswerFromDescription(questions[index], description);
      return inferred ? ensureThreeToFourWordPhrase(inferred, questions[index]) : '';
    });
  } catch (error) {
    console.error('Error generating suggested founder answers with Gemini:', error);
    return fallbackAnswers;
  }
};

/**
 * Fallback questions based on category when AI is unavailable
 */
const getFallbackQuestions = (category: string, description: string): string[] => {
  return normalizeQuestionsForPhraseAnswers(buildKnowledgeBaseQuestions(category, description, 10));
};

/**
 * Test the Gemini service
 */
export const testGeminiService = async (): Promise<boolean> => {
  try {
    const testQuestions = await generateVerificationQuestions({
      category: 'Electronics',
      description: 'Black iPhone 13 Pro with a cracked screen protector',
    });

    return testQuestions.length === 10;
  } catch (error) {
    console.error('Gemini service test failed:', error);
    return false;
  }
};

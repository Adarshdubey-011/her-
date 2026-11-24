// Emergency and safety detection for English, Hindi (Devanagari) and Hinglish (Roman Hindi). Runs only in the browser.
//
// It reads CONTEXT, not just keywords:
//  - negation ("he never hit me") and media/jokes ("in the movie he kills her") switch a match off
//  - idioms ("dying of laughter", "mar jaungi hasi se") are removed first
//  - past ("last year") lowers a level, "right now / abhi / outside my door" raises it
//  - the last few messages matter: "he is outside" after a stalking message is urgent, on its own it is not
//  - third person ("my sister is being beaten") is flagged so the reply can speak to that
//
// level: 0 none | 1 distress | 2 concern (ongoing harassment/threat) | 3 urgent danger | 4 critical (happening now / intent now)
// This is a safety net in front of the AI, never a replacement for human judgement. It errs toward showing help.

const nfkc = (s) => s.normalize("NFKC");
// Word boundaries that work for Devanagari and Latin: < and > in a pattern mean "not touching another letter".
const rx = (src, flags = "iu") => new RegExp(nfkc(src).replace(/</g, "(?<![\\p{L}\\p{M}])").replace(/>/g, "(?![\\p{L}\\p{M}])"), flags);

export const normalize = (text) =>
  nfkc(String(text ?? ""))
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/(\p{L})\1{2,}/gu, "$1$1")          // "pleaseeee" -> "pleaee"
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ---- clause splitting: "he didn't hit me but he threatened to kill me" must be judged as two things ----
const SPLIT = rx("[.!?;\\n]+|<(but|though|however|lekin|magar|parantu|par)>|लेकिन|मगर|परंतु");
const clauses = (t) => t.split(SPLIT).map((c) => (c || "").trim()).filter((c) => c.length > 1);

// ---- things that switch a match off or change its weight ----
const NEG = rx("<(not|no|never|didn'?t|doesn'?t|don'?t|wasn'?t|isn'?t|aren'?t|haven'?t|hasn'?t|won'?t|nahi|nahin|nhi|nai|na|mat|kabhi nahi)>|नहीं|नही|मत");
const NEG_NOT_REALLY = rx("<(stop|stops|leave|let|quit|ruk|rukta|rukti|chhod|chhodta|chhodti|chod|chodta|baaz|hat|hatta)>|रुक|छोड़|बाज़");   // "won't stop", "peecha nahi chhodta"
const MEDIA = rx("<(movie|film|cinema|serial|show|series|episode|story|novel|book|song|lyrics|game|gaming|anime|drama|joke|prank|dream|kahani|picture|natak)>|फिल्म|फ़िल्म|कहानी|सीरियल|गाना|मज़ाक|मजाक");
const HYPO = rx("<(if|suppose|imagine|what if|agar|maan lo|kya hoga agar)>|अगर");
const HUMOR = rx("<(lol|lmao|haha|hehe|jk|just kidding|kidding|mazak)>|😂|🤣|😭😭");
const PAST = rx("<(yesterday|last (night|week|month|year)|years? ago|months? ago|weeks? ago|days? ago|back then|used to|when i was|kal raat|kal|pichle|pichhle|purane|bachpan me|saal pehle|mahine pehle|pehle (se|kabhi)|karta tha|karti thi|karte the|kiya tha)>|कल रात|पिछले|पहले|बचपन");
const NOW = rx("<(right now|now|just now|at this moment|currently|abhi|abhi abhi|is here|are here|outside|at my door|at the door|bahar|darwaze|darwaza|yahan aa gaya|aa gaya|aa gaya hai|aaya hai|aa raha|aa rahe)>|अभी|बाहर|दरवाज़े|दरवाजे|आ गया|यहाँ आ");
const THIRD = rx("<(my|meri|mere|mera)? ?(friend|sister|mother|mom|mum|neighbou?r|colleague|cousin|daughter|aunt|bhabhi|didi|behen|dost|saheli|padosan|maa|mummy|beti)>|मेरी (दोस्त|बहन|माँ|बेटी|सहेली|पड़ोसन)|मेरे (दोस्त|पड़ोसी)");
const SELF = rx("<(me|my|mine|myself|i|i'?m|i'?ve|mujhe|mujhko|mera|meri|mere|main|mai|mai ne|maine)>|मुझे|मुझको|मेरा|मेरी|मेरे|मैं|मैंने");

// idioms that sound dangerous but are not
const FIGURATIVE = [
  rx("<(kill|killing|killed) (time|it|the (vibe|mood|game))>"), rx("dressed to kill"), rx("<(dying|died|dead|die) (of|from|with) (laugh|laughter|embarrassment|shame|boredom|hunger|cringe)\\w*>"),
  rx("<(exam|test|paper|homework|assignment|workload|heat|traffic|deadline|presentation|interview|class|work|syllabus|boredom|cringe|this (show|song|meme|game))\\w* (will|is going to|is gonna|gonna|would) (kill|murder) me>"), rx("to die for"), rx("<(dying|dead) (to|for)>"), rx("<(murder|murdered|killing|killed|slay\\w*|destroy\\w*) (the|my|this|that) (exam|test|interview|presentation|workout|look|dance|outfit|performance)>"),
  rx("<(mar|mer|maar) (jaun|jaungi|jaunga|gayi|gaya|gai)\\w* (hansi|sharm|bore|hunger|bhook)\\w*>"), rx("(hansi|sharm|bhook|bore|dar) (se|ke maare|ke mare) (mar|mer)\\w*"),
  rx("<(exam|test|paper|homework|assignment|traffic|heat|garmi)\\w* ne (maar|mar)\\w*"), rx("<bore ho (ke|kar) (mar|maar)\\w*"), rx("हँस.{0,12}मर|शर्म से मर|भूख से मर"),
];

// ---- the rules ----
// base: starting level. cat: category. re: patterns. Optional: neg:false = negation does not switch it off (fear words),
// floorPast: lowest level a past mention is lowered to. self:true = this rule is about harming oneself.
const RULES = [
  // harming oneself (checked first because it is the most serious silent risk)
  { id: "self_harm", cat: "self_harm", base: 3, self: true, floorPast: 3, re: [
    rx("<(kill|hurt|harm|cut|end|hang|poison|drown|burn|shoot|stab|punish) (my ?self|my life|my own life)>"), rx("suicid(e|al)"), rx("<(want|wanted|wanna|wish|going|plan|planning|thinking|trying)( to| of| about)? (die|dying|disappear|end (it|everything|my life)|be dead|not (live|wake up|be here|exist))>"),
    rx("(better off dead|no reason to live|can'?t go on|end it all|take my own life|don'?t want to (live|be here|exist)|jump (off|from)|overdose)"), rx("<wish i (was|were) dead>"),
    rx("<(marna|mar jana|mar jaana|jeena|jee na|jeene)\\s?(nahi\\s)?(chahti|chahta|chahiye|ka mann|ki ichha|ka koi matlab)"), rx("<(mar jaun|mar jaungi|mar jaunga|mar jau)>"), rx("khud ko (khatam|maar|hurt|nuksan|chot)"), rx("zindagi (khatam|se thak)|jeevan khatam|aatmahatya|atmahatya|sab khatam kar"),
    rx("मरना चाहती|मर जाना चाहती|मरना चाहता|जीना नहीं चाहती|जीने का मन नहीं|जीने की इच्छा नहीं|खुद को (खत्म|मार|नुकसान|चोट)|आत्महत्या|ज़िंदगी खत्म|जिंदगी खत्म|जान दे दू"),
  ] },
  // sexual violence
  { id: "sexual_violence", cat: "sexual_violence", base: 3, floorPast: 2, re: [
    rx("<(rape|raped|raping|molest(ed|ing|s)?|sexually (assault|abus|harass)\\w*|groped|groping|forced (me|himself|herself)|forced (sex|myself)|touched me (without|against|inappropriately))>"),
    rx("<(balatkar|balaatkar|jabardasti|jabardasti kiya|zabardasti|rape kiya|rape kar)>"), rx("galat (jagah|tareeke se|tarah se) (chhu|touch|haath)"), rx("बलात्कार|रेप|जबरदस्ती|ज़बरदस्ती|छेड़खानी|छेड़छाड़|गलत जगह (छू|हाथ)"),
  ] },
  // being attacked
  { id: "violence", cat: "violence", base: 3, floorPast: 2, re: [
    rx("<(hit|hits|hitting|beat|beats|beating|slap|slaps|slapped|slapping|kick|kicks|kicked|kicking|choke|chokes|choked|choking|strangle\\w*|punch\\w*|attack\\w*|assault\\w*|push(ed|es|ing)?|drag(ged|s|ging)?|burn(ed|t|s|ing)?|stab(bed|s|bing)?|shot|hurt(s|ing)?|grab(bed|s|bing)?|slam(med|s|ming)?) (me|her|us)>"),
    rx("<(he|she|they|husband|boyfriend|ex|partner|father|brother|dad|in-?laws?) (hit|beat|slapped|kicked|choked|pushed|burnt|hurt)\\w* (me|her)>"),
    rx("mujhe (bahut |roz |bohot )?(maar|peet|pit|mar|thappad|dhakka|lat|laat|ghoons|gala)\\w*"), rx("<(maarta|maarti|maarte|marta|peetta|peetti|peette|pitta|pitai|maarpeet|marpeet|marpit)( hai| h| hain| raha| rahe| karta)?>"), rx("haath uth(ata|aya|aaya|ayi|ati)"), rx("gala (daba|dabaya|dabata|dabana)"),
    rx("<(locked|lock(ed)? me|won'?t let me (leave|go|out)|kept me (locked|in)|band kar (diya|ke)|kamre me band|bahar nahi (jaane|jane) (deta|deti|dete))>"),
    rx("मुझे (मारता|मारती|मारते|मारा|पीटता|पीटा|थप्पड़|धक्का|लात)|मारपीट|हाथ उठा|गला दबा|कमरे में बंद"), rx("(मारता|मारती|मारते|पीटता|पीटती|पीटते) (है|हैं|रहा|रही|रहे)"),
    rx("<(is|are|was|were|being|got|gets|get) (being )?(beaten|hit|slapped|choked|burnt|burned|abused|tortured|attacked|assaulted)>"),
  ] },
  // threats to hurt or kill
  { id: "kill_threat", cat: "threat", base: 3, floorPast: 2, re: [
    rx("<(kill|murder|stab|shoot|burn|strangle|choke|slit|finish)( \\w+){0,2} (me|her|us)>"), rx("<(will|going to|gonna|wants? to|threat\\w*( to)?|swore( to)?|promised( to)?|said (he|she|they)( will| would)?) (kill|murder|stab|shoot|burn|beat|hurt|harm|rape|end)\\b"),
    rx("(maar|mar) (dal|daal)\\w*"), rx("jaan se (maar|khatam|haath)"), rx("khatam kar (dunga|dega|denge|dungi|degi|do)"), rx("(zinda|jinda|zindaa) nahi chh(od|or)\\w*"), rx("तुझे नहीं छोड़ूँ|ज़िंदा नहीं छोड़|जिंदा नहीं छोड़|जान से (मार|खत्म)|मार (डाल|दू|दे)\\w*|खत्म कर (दू|दे)\\w*"),
  ] },
  // other threats, blackmail
  { id: "blackmail", cat: "blackmail", base: 2, floorPast: 1, re: [
    rx("<(blackmail\\w*|sextortion|extort\\w*|morph(ed|ing)?)>"), rx("<(leak|leaked|leaking|post|share|upload|send|expose|viral)( \\w+){0,3} (photos?|pics?|videos?|nudes?|images?|me|it)>"), rx("<(threaten\\w*|said|says) (to|he will|she will|they will) (post|share|leak|upload|send|expose)>"),
    rx("(photo|photos|video|videos|pics?|nude|nudes)\\w* (viral|leak)\\w*"), rx("(viral|leak) kar (dunga|dega|denge|diya|diye|dungi)"), rx("(photo|video|pic)\\w* (daal|bhej|upload) (dunga|dega|denge|dungi)"), rx("paise maang\\w*|paise na (diye|dene)"), rx("<(nude|nudes) (photo|pic|video)>"),
    rx("ब्लैकमेल|वायरल|अश्लील (फोटो|वीडियो)|फोटो (वायरल|लीक)|वीडियो (वायरल|लीक)"),
  ] },
  { id: "threat", cat: "threat", base: 2, floorPast: 1, re: [
    rx("<(threaten\\w*|threat|threats)>"), rx("dhamk(i|ee|iyan|a|aya|ata|ati|ate)\\w*"), rx("dekh lunga|dekh lenge|dekh lungi|dekh lega|dekh lenge"), rx("धमकी|धमका"),
  ] },
  // being followed / watched
  { id: "stalking", cat: "stalking", base: 2, floorPast: 1, re: [
    rx("<(follow(s|ed|ing)?|stalk(s|ed|ing|er)?|spy(ing)? on|tracking|tracks|tracked|watching) (me|her)>"), rx("<(keeps?|kept|keep) (following|calling|texting|messaging|showing up|stalking|watching|coming)>"), rx("<waiting (outside|near|for me)>"), rx("<(outside|near) my (house|home|college|office|hostel|pg|work|gate|door|building)>"),
    rx("peech(a|e)\\s?(kar|karta|karti|karte|pada|pade|nahi chhod|nahi chod|nahi chodta|nahi chhodta)\\w*"), rx("pichh?(a|e)\\s?(kar|karta|karti|pada|pade|aa|aata|aati)\\w*"), rx("<(follow|stalk) kar\\w*"), rx("nazar rakh\\w*"), rx("baar baar (call|phone|message|msg|text|dm)\\w*"), rx("(ghar|hostel|college|office|gate) ke (bahar|paas) (khada|khadi|khade|ruka|rukta|wait)\\w*"),
    rx("पीछा|पीछे पड़|पीछे आ|नज़र रख|नजर रख|बार-बार (फ़ोन|फोन|कॉल|मैसेज)|घर के बाहर (खड़ा|खड़ी|खड़े)"),
  ] },
  // at home
  { id: "domestic", cat: "domestic", base: 2, floorPast: 1, re: [
    rx("<(domestic violence|dowry|dahej|torture(d|s)?|abus(e|ed|es|ing|ive))>"), rx("<(husband|pati|in-?laws?|sasural|sasur|saas|mother-in-law|boyfriend|partner|ex|bf|father|brother) (abuse|torture|harass|beat|hit|threaten|control|scold)\\w*"), rx("(ghar se )?nikal (diya|dega|do|denge)|kicked me out|threw me out"), rx("मानसिक प्रताड़ना|दहेज|घरेलू हिंसा|ससुराल वाले"),
  ] },
  // at work or on the street
  { id: "harassment", cat: "harassment", base: 2, floorPast: 1, re: [
    rx("<(harass(ed|es|ing|ment)?|eve ?teas\\w*|catcall\\w*|inappropriate(ly)? (touch|comment|message|text|photo|video|advance)\\w*|sexual (comment|remark|advance|favou?r|message)\\w*|obscene|pervert)>"), rx("<(touch|touched|touching|grabbed|brush(ed)?) (me|my)>"), rx("<(boss|manager|colleague|professor|teacher|sir|senior|client|driver|neighbou?r|landlord)( \\w+){0,3} (touch|comment|message|call|text|harass|pressure|stare|stalk)\\w*"),
    rx("(haath|hath) (lagata|lagaya|lagaye|lagana)|galat nazar|(ganda|gande|gandi) (message|msg|comment|baat)|chhed(ta|ti|te|na)? (hai|raha|rahe)"), rx("यौन (उत्पीड़न|शोषण)|छेड़ (रहा|रहे|ता|ते)|गंदा (मैसेज|कमेंट)|गलत नज़र"),
  ] },
  { id: "workplace", cat: "workplace", base: 2, floorPast: 1, re: [
    rx("<(posh|internal committee|icc|hr)>.{0,40}<(harass\\w*|complain\\w*)>"), rx("(boss|manager|senior|sir)\\b.{0,30}\\b(favou?r|date|dinner|hotel|room|massage)\\b"), rx("(boss|manager|office|workplace|colleague)\\b.{0,25}\\b(harass|touch|ganda|pressure)\\w*"),
  ] },
  // asking for help
  { id: "help_cry", cat: "help", base: 2, neg: false, re: [rx("<(help me|please help|save me|somebody help|someone help|i need help right now)>"), rx("<(bachao|bacha lo|bachaiye|madad (karo|kijiye|chahiye)|help karo)>"), rx("बचाओ|बचा लो|मदद (करो|कीजिए|चाहिए)")] },
  // unsafe feelings
  { id: "unsafe", cat: "distress", base: 1, neg: false, re: [rx("<(unsafe|not safe|in danger|danger|endangered)>"), rx("safe (nahi|nhi)|khatre me|खतरे में|असुरक्षित|सुरक्षित नहीं")] },
  { id: "panic", cat: "panic", base: 1, neg: false, calm: true, re: [rx("<(panic\\w*|can'?t breathe|cannot breathe|breathless|hyperventilat\\w*|heart (is )?racing|shaking|trembling|shivering|overwhelm\\w*)>"), rx("saans (nahi|nhi|phool)|dhadkan|kaamp|ghabra\\w*|ghabrahat"), rx("घबरा|साँस (नहीं|फूल)|धड़कन|काँप|बेचैन")] },
  { id: "distress", cat: "distress", base: 1, neg: false, re: [
    rx("<(scared|afraid|fear|fearful|terrified|frightened|anxious|anxiety|nervous|helpless|hopeless|crying|cried|depress\\w*|heartbroken|stressed|stress|worried|trauma\\w*|nightmare\\w*|lonely|alone|upset|distress\\w*|sad|numb|worthless|ashamed|guilty|trapped)>"), rx("<(darr|dar|darr lag|dar lag|darta|darti|pareshan|parishan|udaas|rona|ro rahi|ro raha|akeli|akela|tension|bura lag|toot|tut|neend nahi|bechain)\\w*"),
    rx("डर|परेशान|उदास|रो (रही|रहा)|अकेली|अकेला|तनाव|चिंता|हताश|शर्म"),
  ] },
];

const isSelfAgent = (clause) => SELF.test(clause) || !THIRD.test(clause);

const negatedAround = (clause, m) => {
  const before = clause.slice(Math.max(0, m.index - 28), m.index);
  const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 22);
  const win = [before, after];
  return win.some((w) => NEG.test(w) && !NEG_NOT_REALLY.test(w) && !NEG_NOT_REALLY.test(m[0]));
};

const stripFigurative = (clause) => FIGURATIVE.reduce((c, f) => c.replace(new RegExp(f.source, f.flags + "g"), " "), clause);

const CAT_LAWS = { stalking: ["stalking"], harassment: ["harassment", "modesty"], sexual_violence: ["harassment", "modesty"], violence: ["modesty", "domestic"], domestic: ["domestic"], blackmail: ["threat", "images"], threat: ["threat"], workplace: ["workplace"] };

/** Judge one clause. Returns {level, rule, cat, immediate, past, third} or null. */
function judgeClause(raw) {
  const media = MEDIA.test(raw);
  const clause = stripFigurative(raw);
  const humor = HUMOR.test(raw);
  const now = NOW.test(clause), past = PAST.test(clause), hypo = HYPO.test(clause), third = THIRD.test(clause) && !/\b(me|mujhe|myself)\b|मुझे/u.test(clause);
  let best = null;
  for (const rule of RULES) {
    for (const re of rule.re) {
      const m = re.exec(clause);
      if (!m) continue;
      let level = rule.base;
      const negatable = rule.neg !== false;
      if (negatable && negatedAround(clause, m)) { level = rule.self ? Math.min(level, 1) : 0; }
      else if (negatable && media) level = 0;
      else {
        if (hypo && negatable) level = Math.max(level - 1, 1);
        if (humor && rule.self) level = Math.min(level, 2);
        if (past && !now) level = Math.max(level - 1, rule.floorPast ?? 1);
        if (now && negatable && rule.base >= 2) level = Math.min(4, level + 1);
        if (now && rule.self && rule.base >= 3) level = 4;
      }
      if (level > 0 && (!best || level > best.level)) best = { level, rule: rule.id, cat: rule.cat, self: !!rule.self, calm: !!rule.calm, immediate: now && level >= 3, past, third };
      break;
    }
  }
  return best;
}

const emptyResult = () => ({ level: 0, categories: [], reasons: [], immediate: false, selfHarm: false, thirdParty: false, calm: false, lawIds: [] });

/** Core judgement of ONE message, without history. */
export function assessMessage(text) {
  const t = normalize(text);
  const out = emptyResult();
  if (!t) return out;
  for (const c of clauses(t)) {
    const j = judgeClause(c);
    if (!j) continue;
    out.level = Math.max(out.level, j.level);
    if (!out.categories.includes(j.cat)) out.categories.push(j.cat);
    if (!out.reasons.includes(j.rule)) out.reasons.push(j.rule);
    out.immediate ||= j.immediate;
    out.selfHarm ||= j.self && j.level >= 3;
    out.thirdParty ||= j.third && j.level >= 2;
    out.calm ||= j.calm;
  }
  return out;
}

// "he is here", "wo bahar hai", "he's outside": meaningless alone, urgent after a stalking or threat message.
const PRESENCE = rx("(<(he|she|they|wo|woh|vo|usne|use|unhone)>|वह|वो).{0,24}(<(here|outside|nearby|at (my )?(door|gate|window)|aa gaya|aa gaya hai|aaya|aaya hai|bahar|yahan|yahaan|paas|pahunch gaya)>|यहाँ|बाहर|आ गया|आया है|पहुँच)");
const PRESENCE2 = rx("<(someone|koi) (is|hai) (at|outside|bahar|knocking|darwaze)\\w*");
const SHORT_HELP = rx("^(help|please|pls|plz|hello\\??|hi\\??|bachao|madad|are you there\\??|hello hello)\\W*$");

/**
 * Judge a message in its conversation. `history` = earlier messages from the user, oldest first (strings).
 * Returns { level, categories, reasons, immediate, selfHarm, thirdParty, calm, lawIds, escalated }.
 */
export function assess(text, history = []) {
  const now = assessMessage(text);
  const prior = (history || []).slice(-4).map(assessMessage);
  const priorMax = prior.reduce((m, p) => Math.max(m, p.level), 0);
  const priorCats = [...new Set(prior.flatMap((p) => p.categories))];
  const risky = priorCats.filter((c) => ["stalking", "threat", "domestic", "blackmail", "violence", "sexual_violence", "harassment"].includes(c));
  const t = normalize(text);
  let escalated = false;

  if (priorMax >= 2 && risky.length) {
    if ((PRESENCE.test(t) || PRESENCE2.test(t)) && now.level < 3) { now.level = 3; now.immediate = true; now.categories.push(...risky.filter((c) => !now.categories.includes(c))); now.reasons.push("context_presence"); escalated = true; }
    else if (SHORT_HELP.test(t) && now.level < 3) { now.level = Math.max(now.level, 3); now.immediate = true; now.categories.push(...risky.filter((c) => !now.categories.includes(c))); now.reasons.push("context_help"); escalated = true; }
    else if (now.level >= 1 && now.level < 3 && prior.some((p) => p.level >= 3)) { now.level = Math.max(now.level, 2); escalated = true; }
  }
  if (priorMax >= 3 && prior.slice(-2).some((p) => p.selfHarm) && now.level < 2 && !now.selfHarm) { now.level = 2; now.categories.push("self_harm"); now.reasons.push("context_selfharm"); escalated = true; }   // stay careful right after a self-harm message
  now.selfHarm ||= escalated && now.categories.includes("self_harm") && now.level >= 3;
  now.escalated = escalated;
  now.lawIds = [...new Set(now.categories.flatMap((c) => CAT_LAWS[c] || []))];
  return now;
}

/** Which UI treatment a result deserves. */
export const treatment = (a) => (a.selfHarm ? "selfharm" : a.level >= 3 ? "urgent" : a.level === 2 ? "concern" : "none");

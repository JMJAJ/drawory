// Custom chat emojis: write :name: in a message and it shows as the picture. Like stickers, the
// server copies each one from Discord the first time it's shown and serves it from the database
// after that (/api/emojis/...).

export interface Emoji {
  name: string;
  url: string;
}

/** [name, Discord emoji id]. Names that appear twice get _2, _3… so every picture is reachable. */
const LIST: [string, string][] = [
  ["meryltrytosmile", "951347821204865064"], ["merylurk", "951347827857051678"], ["merylhug", "951347828582653952"],
  ["shirowarning", "951347830096801822"], ["shirowantyou", "951347831409610782"], ["shirocozy", "951347831690649620"],
  ["samirthinking", "951347833049587772"], ["samirapproaching", "951347833217363988"], ["humapleadingface", "951347833355776031"],
  ["samirjokinga", "951347833410314270"], ["humahuh", "951347833489993728"], ["samiroops", "951347833645203476"],
  ["samirwhat", "951347833800376370"], ["humasleeping", "951347833993298021"], ["speechless", "951347835020922890"],
  ["merylwow", "955329814351450162"], ["miaConfused", "975522458671128636"], ["miaKnife", "975524281461121024"],
  ["miaTofu", "975524372745965568"], ["miaDerp", "975525442062778389"], ["samirGun", "975525442209579008"],
  ["miaCrying", "977661356197183508"], ["miaStarstruck", "982828237291921479"], ["miaApproves", "985243203097747456"],
  ["samirGunspam", "985243604144492556"], ["miaLove", "986665774439604285"], ["miaSad", "990754640620560414"],
  ["miaEyes", "991488352064901191"], ["miaFire", "992835665777655938"], ["miaOhmy", "993676773768306719"],
  ["miaBurnitall", "996164079771209748"], ["miaSmug_1", "996602870109577301"], ["releaseDate_EU", "1002264232609452123"],
  ["releaseDate_NA", "1002264244210901172"], ["miaWinky", "1005531484515467366"], ["miaThanks", "1005664645220147311"],
  ["zAPAC_Server", "1006207959287738429"], ["zEU_Server", "1006208006003884153"], ["zNA_Server", "1006208065365889146"],
  ["zSA_Server", "1006208091802587206"], ["zSEA_Server", "1006208120638406656"], ["miaPointup", "1006332995671699568"],
  ["miaLurking", "1007843707736821830"], ["miaBanhammer", "1007843709003501568"], ["miaScream", "1007843710119190669"],
  ["mia_aidaguide", "1010649835898159114"], ["miaCopium", "1026218640829321316"], ["miaKaboom", "1032360092508622939"],
  ["fenrirSmile", "1044362580820512808"], ["kekritter", "1047351767601532928"], ["tianLove", "1055308777039073370"],
  ["linyeLove", "1055555035037180064"], ["annaHmmbella", "1063002542281347133"], ["cobaltBee", "1063673727805562981"],
  ["lyrapunch", "1064051717295067206"], ["annaCheeky", "1064051720126214235"], ["annaHuehue", "1064051722093346867"],
  ["claudia", "1064051723829788762"], ["rubysparky", "1064051736307834921"], ["rubydrag", "1064051743559798915"],
  ["sakiokay", "1064052312789766234"], ["annaHuehue", "1064054364626505838"], ["rubyStare", "1077376950353534988"],
  ["fenrirDerp", "1083279136996470794"], ["miaSleep", "1084966238104588319"], ["miaNoted", "1089999988123254794"],
  ["miaSus", "1090000111104438433"], ["miaPopcorn", "1090000220009537546"], ["shiroderp", "1090002680757358652"],
  ["fenrirDerppat", "1090897533884182531"], ["miaRiot", "1106848244320976977"], ["miaPats", "1106848248171352064"],
  ["miaRave", "1106848253321945098"], ["miaConfused", "1106848260183826444"], ["miaCone", "1117627572403044392"],
  ["zekek", "1117649618902196314"], ["liuhuocry", "1122686528917872650"], ["liuhuokekwait", "1122687129366057001"],
  ["liuhuoangry", "1123155559093370967"], ["zelement_altered", "1123707539985547355"], ["zelement_volt", "1123707541193498624"],
  ["zelement_physical", "1123707543194173550"], ["zelement_frost", "1123707544888684635"], ["zelement_flame", "1123707546868400128"],
  ["tataworking", "1141431691798392862"], ["tataworking2", "1141431744634028122"], ["huangangry", "1145697724210098267"],
  ["huang", "1145697939923157002"], ["miaPopcorn", "1157335444128792676"], ["zekeCrying", "1161772756967374908"],
  ["moliniaScared", "1161993675409211444"], ["moliniaScared", "1161994063080325141"], ["zekecrying", "1162722446265286706"],
  ["shironya", "1163079799984635955"], ["humasad", "1163081630357934111"], ["fenrirkek", "1174337106999529542"],
  ["laneating", "1174351367037526127"], ["fionasleepy", "1174352298487586837"], ["rubilia", "1174352634929500160"],
  ["huangangry", "1174353035657494768"], ["huangscared", "1174353522624561273"], ["linghanno", "1174354471778779206"],
  ["fenrirkekcry", "1175825757486993498"], ["shiroangereyes", "1175864130981343294"], ["shirotongue", "1175870947891367997"],
  ["shirosadeatpaw", "1175877814721986590"], ["shirotonguee", "1176142037507133550"], ["nanyinLurk", "1176526650264002680"],
  ["yulanPray", "1176526877549137970"], ["zekeConfused", "1176527299143803022"], ["empcrying", "1177304442312347679"],
  ["nanyinscared", "1177322103008141464"], ["miaMoney", "1177552029174988850"], ["jiyuSip", "1179488484902309980"],
  ["yanSad", "1179510821735370863"], ["xiaobao_angry", "1180868575762841670"], ["xiaobao_food", "1180870561656746054"],
  ["xiaobao_food_2", "1180870627062714378"], ["xiaobao_sleepy", "1180870680703664239"], ["xiaobao_happy", "1180870745342083132"],
  ["xiaobao_sayshi", "1180870799155007569"], ["xiaobao_thinking", "1180889264104427530"], ["xiaobao_scream", "1180889312913522781"],
  ["shirliHappy", "1181248506866974820"], ["shirliHappy", "1181250618401239070"], ["fenrirLick", "1183030809645564056"],
  ["fenrirDance", "1184432868139737088"], ["fenrirLick2", "1184436511068921866"], ["shirliLove", "1186684113256714372"],
  ["zekeConfused", "1186684256202793010"], ["tataHi", "1186684324288929823"], ["zekePat", "1186684384200359966"],
  ["fenrirExcited", "1186684947730284635"], ["zekepat", "1186687658299232388"], ["shirLilove", "1186687945550352454"],
  ["fionaShy", "1186688365169487992"], ["lanLick", "1187034285677482064"], ["lanLick", "1187035672842879026"],
  ["merylPat", "1187038301559980092"], ["merylYay", "1187038453658034196"], ["fenrirExit", "1187044494563102813"],
  ["fenrirEnter", "1187048802809565234"], ["miaPolice", "1187370878955159646"], ["linHello", "1187371819360059454"],
  ["rubyDisappointed", "1187373744331685918"], ["jiyuThinking", "1187376019531902976"], ["jiyuSmile", "1187376087601266798"],
  ["yanTired", "1187377163402493992"], ["fenrirExcited", "1187435617781555331"], ["liuhuoAngry", "1187436123337797642"],
  ["catHuhh", "1187491415178096671"], ["shiroEvil", "1187500030173659226"], ["shiroEvil", "1187500803938857060"],
  ["xiaobao_rocksus", "1189178487827877888"], ["xiaobao_cry", "1189180402221449256"], ["xiaobao_skilljuice", "1189187511822602252"],
  ["annaBald", "1198035669721825421"], ["annaThumbsup", "1198036377200230571"], ["annaSus", "1200420452204544090"],
  ["annaLaugh", "1201106567345487872"], ["lanThinkstare", "1201107261695742055"], ["annaScream", "1201108166088343632"],
  ["lanConfused", "1201108708051144805"], ["lanHmm", "1201109238081134632"], ["lanSmile", "1201109816710533130"],
  ["annaScary", "1201110378571112490"], ["xiaobao_hmm", "1205543838194597900"], ["yanuoConfused", "1205604696954241064"],
  ["miaWalking", "1205995549765931028"], ["zdarkcrystal", "1208869528625352734"], ["znucleus_red", "1208873238776520714"],
  ["zvoucher_red", "1208875180554850425"], ["ztanium", "1208875375166365847"], ["znucleus_black", "1208877496284610632"],
  ["znucleus_gold", "1208877554572730389"], ["zvoucher_gold", "1208877591331864598"], ["miaA", "1215065297615331328"],
  ["miaDeadPan", "1215065494277857340"], ["miaheh", "1215065544739389471"], ["miaWow", "1215067208690962542"],
  ["linLove", "1215361709020151838"], ["zflame_gold", "1215415073451810838"], ["zblack_gold", "1215415097657401364"],
  ["miaPop", "1216205385912946728"], ["miaSmug_2", "1216207274775806033"], ["miaBlep", "1216214164150816788"],
  ["shiroClown", "1224236781147258990"], ["shiroclown1", "1224245506675572848"], ["shiroclown2", "1224245662590308474"],
  ["xiaobao_joy", "1229305470108565524"], ["xiaobao_choke", "1230838993982193744"], ["xiaobao_tongue", "1230839222441742346"],
  ["necomiaSad", "1233967386542084166"], ["jiyuEvil", "1233969135801598012"], ["miaPingshake", "1234762826510499881"],
  ["xiaobao_screamshake", "1234763249921036369"], ["miaFood", "1235756010946297957"], ["ankaCrying", "1258964067939389531"],
  ["ankaPlease", "1258969158570217482"], ["miaBdayjam", "1263887238471745566"], ["miaFire", "1267991415518920757"],
  ["popeRedNucleus", "1269094706974031963"], ["xiaobao_stare", "1272389618284888079"], ["xiaobao_stare", "1272390099069308928"],
  ["shellyHappyCookie", "1276081854839263297"], ["shellyDrunk", "1276095238599086134"], ["shellyDrink", "1276095296408916049"],
  ["shellyLove", "1276129410608660482"], ["miaHelp", "1276545469602070569"], ["miaHelp2", "1276545488283504834"],
  ["miaJail", "1276601073863229471"], ["miaLook1", "1276601126548013057"], ["miaLook2", "1276601565154906162"],
  ["necomia", "1276853890800947255"], ["miaStare", "1276853989929127968"], ["miaISee", "1276854078575611924"],
  ["miaHorror", "1276854121345056808"], ["miaNou", "1276854203108823092"], ["miaHi", "1276854222637236244"],
  ["miaPat", "1276854430062612490"], ["miaFlower", "1276854432042061916"], ["miaTea", "1276854520093212693"],
  ["miaChoke", "1276854521628200970"], ["miaOmnom", "1276854639966289991"], ["miaPain", "1276854648103243857"],
  ["miaReadRules", "1276854758119837807"], ["miaF", "1276854774247067750"], ["miaDone", "1276854796053123143"],
  ["miaWow_2", "1276855034201772064"], ["miaAngry", "1276855036361834546"], ["miaWow_1", "1276855038404333683"],
  ["flexR", "1276855246022508597"], ["flexL", "1276855247687389226"], ["miaBeg", "1276856662073802805"],
  ["miaSkillIssue", "1276856663864774747"], ["miaRedNucleus", "1276857038680363079"], ["miaHug", "1276857757877928027"],
  ["miaNo", "1276857971074400298"], ["miaYes", "1276857972877951028"], ["miaGun1", "1276858506409934908"],
  ["miaGun2", "1276858508544966668"], ["miaPing", "1276858641663660072"], ["miaSmall", "1276859042123481108"],
  ["miaKnife", "1276859161392578661"], ["miaBday", "1276859472555282442"], ["miaRave", "1276860521186070650"],
  ["miaClassy", "1276944275040501918"], ["miaPirate", "1276944329696608277"], ["plottiSmol", "1299528516605579285"],
  ["miaFinger", "1299771012287828028"], ["fenrirNo", "1299813177344659509"], ["fenrirDamn", "1299813225721892864"],
  ["fenrirCry", "1299813267136446576"], ["annaGloweyes", "1300211730172870776"], ["annaStare", "1300211947559452733"],
  ["fenrirSleep", "1300464127583584327"], ["fenrirLurk", "1300469453544357888"], ["fenrirBonk", "1300497895279169536"],
  ["fenrircryBonk", "1300497915634257960"], ["asuradaSip", "1301586032436707410"], ["asuradaCry", "1301995108610084995"],
  ["xiaobao", "1318217363165806713"], ["xiaobaoBoopTheSnoot", "1318217800619397150"], ["bruce_grab", "1318217956156637235"],
  ["miaCry", "1321350772860125304"], ["miaCry", "1321350890958884984"], ["miaPlease", "1322307422785896488"],
  ["miaHmm", "1322320773914034318"], ["grayfoxHappy", "1324811894728691744"], ["grayfoxCheeks", "1324900701104635974"],
  ["antoriaShrug", "1345848713511174164"], ["fenrirWow", "1348068357840179210"], ["fenrirMagic", "1349308324759207946"],
  ["fenrirCheers", "1349412306584600670"], ["fenrirCheeks", "1349412329481044109"], ["fenrirDoro", "1349412374008041614"],
  ["asterNoted", "1387566881543684138"], ["miaBonk", "1390425964223135834"], ["heleneSleep", "1420372984924864523"],
  ["asuradaConfused", "1420373270871675010"], ["antoliaWoops", "1420373674804121711"], ["tof_cs", "1488201506791358684"],
  ["nantoFine", "1488201536956928070"], ["noraDespise", "1488201554279272528"], ["roslynBan", "1488201572302327909"],
  ["agleiaWow", "1498682594521514004"], ["carrotBeg", "1535993752466886746"], ["grayfoxUnsure", "1535994041668210711"],
  ["harmopheusThumbsUp", "1535994435286999100"],
];

export const EMOJIS: Emoji[] = (() => {
  const taken = new Map<string, number>();
  return LIST.map(([name, id]) => {
    const n = (taken.get(name) ?? 0) + 1;
    taken.set(name, n);
    return { name: n === 1 ? name : `${name}_${n}`, url: `/api/emojis/${id}.png` };
  });
})();

const EXACT = new Map(EMOJIS.map((e) => [e.name, e]));
const LOWER = new Map<string, Emoji>();
for (const e of EMOJIS) if (!LOWER.has(e.name.toLowerCase())) LOWER.set(e.name.toLowerCase(), e);

/** The emoji for :name: (exact, then any capitals, then the first whose name starts with it). */
export function findEmoji(name: string, room: readonly Emoji[] = []): Emoji | undefined {
  const lower = name.toLowerCase();
  // The room's own emojis (made from drawings) come first.
  const mine = room.find((e) => e.name === name) ?? room.find((e) => e.name.toLowerCase() === lower);
  if (mine) return mine;
  return (
    EXACT.get(name) ??
    LOWER.get(lower) ??
    (lower.length >= 3 ? [...room, ...EMOJIS].find((e) => e.name.toLowerCase().startsWith(lower)) : undefined)
  );
}

/** Emojis whose names contain what's typed, best matches (starting with it) first. */
export function searchEmojis(q: string, limit = 8, room: readonly Emoji[] = []) {
  const all = [...room, ...EMOJIS];
  const lower = q.toLowerCase();
  if (!lower) return all.slice(0, limit);
  const starts = all.filter((e) => e.name.toLowerCase().startsWith(lower));
  const has = all.filter((e) => !e.name.toLowerCase().startsWith(lower) && e.name.toLowerCase().includes(lower));
  return [...starts, ...has].slice(0, limit);
}

/** Discord files the server may copy (and nothing else). */
export const EMOJI_FILES = new Set(LIST.map(([, id]) => `${id}.png`));
export const discordEmojiUrl = (file: string) => `https://cdn.discordapp.com/emojis/${file}`;

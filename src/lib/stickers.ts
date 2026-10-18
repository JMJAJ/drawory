// Built-in stickers. The first time one is shown, the server copies it from Discord into the
// database and serves it from there forever after (/api/stickers/...), so they keep working
// even if Discord moves or removes them.

export interface Sticker {
  name: string;
  url: string;
  animated?: boolean;
}

const png = (id: string) => `/api/stickers/${id}.png`;
const gif = (id: string) => `/api/stickers/${id}.gif`;

/** Where to fetch a sticker file from Discord the first time. */
export function discordStickerUrl(file: string) {
  return file.endsWith(".gif") ? `https://media.discordapp.net/stickers/${file}` : `https://cdn.discordapp.com/stickers/${file}`;
}

const DISCORD_STICKER = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/stickers\/(\d+\.(?:png|gif))/;

/** Stickers placed before caching existed point at Discord; serve those from the cache too. */
export function stickerSrc(src: string | undefined) {
  const m = src ? DISCORD_STICKER.exec(src) : null;
  return m ? `/api/stickers/${m[1]}` : src;
}

export const STICKERS: Sticker[] = [
  { name: "Meryl Look", url: png("963704471345590273") },
  { name: "Meryl Lurk", url: png("963705421741305906") },
  { name: "Meryl Yay", url: png("963709049088663594") },
  { name: "Meryl and Shiro", url: png("963709417579229195") },
  { name: "Shiro Nap Time", url: png("963709883377672232") },
  { name: "Shiro Nya~", url: png("963710024176238693") },
  { name: "Shiro Wave", url: png("963710216615120956") },
  { name: "Samir Tug", url: png("963710521041891388") },
  { name: "Samir Think", url: png("963710636985024545") },
  { name: "Samir Oops", url: png("963710829176438784") },
  { name: "Samirprised", url: png("963710987834372106") },
  { name: "Samir In my sights", url: png("963711130050646036") },
  { name: "Huma Huh", url: png("963711253111537664") },
  { name: "Huma Sad", url: png("963711372431081502") },
  { name: "Huma and Meryl", url: png("963711821724942376") },
  { name: "Annabella ThinkStare", url: png("1063002883139850240") },
  { name: "Annabella Huhu", url: png("1064053360778559518") },
  { name: "Samir PNG Saved", url: png("1077122665933967380") },
  { name: "Lan", url: png("1157260384907046974") },
  { name: "Fiona Sleepy", url: png("1161752989862731967") },
  { name: "Lan", url: png("1161753742010503301") },
  { name: "Lan Eating", url: png("1161754174887829534") },
  { name: "Rubilia Incredulous", url: png("1161754858332897372") },
  { name: "Zeke Crying", url: png("1161759786908516514") },
  { name: "Molinia Scared", url: png("1161959438043861073") },
  { name: "Huang Fear", url: png("1161970087843086367") },
  { name: "Fei Chilling", url: png("1161975109872013362") },
  { name: "Fei Sleepy", url: png("1161975195549057085") },
  { name: "Ruby Wow", url: png("1162000081759776828") },
  { name: "Lin Yes", url: png("1162001240058765363") },
  { name: "Fenrir Please", url: png("1162003919656988713") },
  { name: "Annabella Cheeks", url: png("1162004385933574184") },
  { name: "Tian and Lyra", url: png("1162005004828295189") },
  { name: "Ruby AAA", url: png("1162010849301499985") },
  { name: "Mia Banhammer", url: png("1162013757715787889") },
  { name: "Mia Scream", url: png("1162014664239087616") },
  { name: "Mia Copium", url: png("1162015215475503175") },
  { name: "Ling Han Bored", url: png("1173347752525168791") },
  { name: "Shirli Happy", url: gif("1181249095709499472"), animated: true },
  { name: "Fen fen", url: gif("1184433661165191188"), animated: true },
  { name: "Fenrir Dance", url: gif("1184437981789044827"), animated: true },
  { name: "Shirli love", url: gif("1186706369986953257"), animated: true },
  { name: "Shiro Clown", url: gif("1224236727854567446"), animated: true },
  { name: "Anka Please", url: gif("1258969021328654397"), animated: true },
  { name: "Anka Crying", url: gif("1258969860852158536"), animated: true },
  { name: "Roslyn News", url: gif("1262601285283090494"), animated: true },
  { name: "Mia Jail", url: png("1276600827053609041") },
  { name: "Mia Choke", url: png("1276940116304068738") },
  { name: "Mia Horror", url: png("1276940212940832963") },
  { name: "Mia Pat", url: png("1276940500150128813") },
  { name: "Mia Done", url: png("1276940560879583283") },
  { name: "Mia Skill issue", url: png("1276940822746501171") },
  { name: "Mia Beg", url: png("1276940910382551182") },
  { name: "Fenrir Lurking", url: png("1300469671669010514") },
  { name: "Asurada", url: png("1301566166560407562") },
  { name: "XiaoBao", url: png("1318217623573495878") },
  { name: "Fenrir Doro", url: png("1349415149097844786") },
  { name: "Holding Carrot", url: gif("1363850669827821598"), animated: true },
  { name: "Helene Sleeping", url: png("1420374534045040660") },
  { name: "Server Open When", url: png("1441046243307421818") },
];

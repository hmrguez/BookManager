/** Original geometric artwork by Wovenleaf contributors, MIT. No external images/fonts. */
import { mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const write = async (path, content) => { const url = new URL(path, root); await mkdir(new URL('.', url), { recursive: true }); await writeFile(url, content); };
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><!-- Original Wovenleaf artwork; MIT License, Copyright 2026 Hector Rodriguez. -->${body}</svg>\n`;
const book = '<path d="M40 180Q100 150 160 180Q220 150 280 180V300Q220 270 160 300Q100 270 40 300ZM160 180V300M62 202Q102 186 136 204M184 204Q224 186 258 202M62 220Q102 204 136 222M184 222Q224 204 258 220"/>';
const symbols = [
  ['01-fantasy', '<path d="M75 154L110 75L145 135L190 45L250 154M178 70L190 84L200 70M94 110L110 122L124 110"/>'],
  ['02-mystery', '<circle cx="150" cy="95" r="46"/><path d="M184 129L220 165M122 100Q150 70 179 100Q150 130 122 100Z"/><circle cx="150" cy="100" r="10"/>'],
  ['03-romance', '<path d="M160 150C50 95 100 25 160 75C220 25 270 95 160 150ZM110 140Q84 116 76 85M210 140Q236 116 244 85"/>'],
  ['04-science-fiction', '<circle cx="160" cy="94" r="44"/><ellipse cx="160" cy="94" rx="85" ry="17" transform="rotate(-25 160 94)"/><path d="M70 55V75M60 65H80M245 125V145M235 135H255"/>'],
  ['05-history', '<path d="M105 50H215M105 150H215M116 52C116 95 145 94 160 104C175 94 204 95 204 52M116 148C116 118 145 114 160 104C175 114 204 118 204 148M128 140L160 119L192 140ZM131 64H189"/>'],
  ['06-literary-fiction', '<path d="M108 152L155 65Q200 25 210 48L181 103ZM140 112L185 66M96 158H218M117 165H204"/>'],
  ['07-nonfiction', '<path d="M160 152V80M160 118Q95 114 100 65Q156 65 160 118ZM160 100Q224 98 220 50Q167 51 160 100ZM127 146H193"/>'],
  ['08-horror', '<path d="M194 42A60 60 0 1 0 222 126A52 52 0 0 1 194 42ZM85 55V75M75 65H95M240 65V85M230 75H250"/>'],
];
for (const [name, symbol] of symbols) await write(`apps/mobile/public/reviews/vector-v2/${name}-artwork.svg`, svg(320, 340, `<g fill="none" stroke="#252722" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${book}${symbol}<path d="M68 320H252"/></g>`));
const text = (x, y, value, size=16) => `<text x="${x}" y="${y}" font-family="Georgia,serif" font-size="${size}" fill="#30352e">${value}</text>`;
const line = (y, width=275) => `<path d="M42 ${y}h${width}" stroke="#a9ad9b" stroke-width="2"/>`;
const frame = body => `<rect width="390" height="844" rx="18" fill="#f4f0e6"/><rect x="18" y="18" width="354" height="808" rx="14" fill="none" stroke="#bfc1b4"/>${text(36,60,'Wovenleaf',25)}${body}${text(36,795,'Illustrative preview · fictional books',12)}`;
let library = text(36,110,'A shelf of possibilities',22);
['The Quiet Orchard','Notes from the Estuary','A Map of Morning'].forEach((title,i) => { const y=145+i*176; library += `<rect x="36" y="${y}" width="82" height="128" rx="3" fill="${['#c5ccb9','#cfc1ad','#b8c6c8'][i]}"/><path d="M50 ${y+22}h54M50 ${y+106}h54" stroke="#737e68"/>${text(140,y+35,title,16)}${text(140,y+63,'Wovenleaf demo',13)}<path d="M140 ${y+90}h180" stroke="#d2d3c7" stroke-width="4"/><path d="M140 ${y+90}h${55+i*40}" stroke="#738369" stroke-width="4"/>`; });
const reader = text(36,115,'The Quiet Orchard',23)+text(36,157,'CHAPTER ONE',12)+['The morning light rested on the wall.','Beyond the window, leaves moved','gently in the wind. There was time','to turn a page, and time to let the','words find their own quiet rhythm.','','She set a notebook beside the chair','and began again. A few lines were','enough to carry into the day.'].map((s,i)=>text(36,215+i*33,s,16)).join('')+line(690)+text(36,735,'12 / 148',14);
const audio = text(36,115,'Listen at your own pace',22)+`<rect x="105" y="168" width="180" height="250" fill="#c5ccb9"/><path d="M132 200h126M132 385h126M195 240v100M170 265q25-50 50 0" stroke="#738369" fill="none"/>`+text(100,455,'The Quiet Orchard',21)+text(130,485,'Wovenleaf demo',14)+line(550)+text(36,580,'12:00',14)+text(292,580,'48:00',14)+`<circle cx="195" cy="650" r="30" fill="none" stroke="#738369"/><path d="M188 637l22 13-22 13Z" fill="#738369"/>`+text(54,655,'↶',28)+text(306,655,'↷',28);
const stats = text(36,115,'Your reading rhythm',24)+text(36,177,'A season among pages',17)+text(36,253,'12 books',40)+text(36,290,'A little progress, day by day.',16)+Array.from({length:12},(_,i)=>`<rect x="${38+i*26}" y="${590-(40+(i*37)%170)}" width="14" height="${40+(i*37)%170}" rx="3" fill="#839478"/>`).join('')+line(610)+text(36,665,'A year of making room for stories.',16);
for (const [name,body] of Object.entries({library,reader,audiobook:audio,stats})) await write(`apps/landing/public/illustrations/${name}.svg`,svg(390,844,frame(body)));

import { readdir, writeFile, mkdir } from 'node:fs/promises';
const directory=new URL('../apps/web/public/music/',import.meta.url);
await mkdir(directory,{recursive:true});
const entries=await readdir(directory,{withFileTypes:true});
const tracks=entries.filter(entry=>entry.isFile()&&!entry.name.startsWith('.')&&!/[\\?#\x00-\x1f]/.test(entry.name)&&/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>({title:entry.name.replace(/\.[^.]+$/,''),url:`/music/${encodeURIComponent(entry.name)}`}));
await writeFile(new URL('playlist.json',directory),JSON.stringify(tracks,null,2)+'\n');

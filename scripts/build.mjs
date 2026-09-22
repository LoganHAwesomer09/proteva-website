import { mkdir, copyFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function build() {
  const output=path.join(root,'dist');
  await mkdir(output,{recursive:true});
  const files=['index.html','app.html','me.html','manifest.json','robots.txt','favicon.ico','favicon-64.png','apple-touch-icon.png','icon-192.png','icon-512.png','proteva-logo.png'];
  for (const file of files) await copyFile(path.join(root,file),path.join(output,file));
  await cp(path.join(root,'assets'),path.join(output,'assets'),{recursive:true});
  await mkdir(path.join(output,'vendor'),{recursive:true});
  await copyFile(path.join(root,'node_modules/lucide/dist/umd/lucide.min.js'),path.join(output,'vendor/lucide.min.js'));
  await copyFile(path.join(root,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),path.join(output,'vendor/supabase.js'));
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await build();
  console.log('Built Proteva static pages and pinned browser dependencies into dist/.');
}

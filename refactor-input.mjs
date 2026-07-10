import fs from 'fs';

let content = fs.readFileSync('app/page.tsx', 'utf-8');

// Replace onChange={(e) => setX(e.target.value)} with onChange={(v) => setX(v)} for Input and Textarea
// Wait, we can't easily parse which tags are Input vs input.
// But we know exactly which ones need changing because they use <Input or <Textarea
const replacements = [
  { search: 'onChange={(e) => setName(e.target.value)}', replace: 'onChange={(v) => setName(v)}' },
  { search: 'onChange={(e) => setUrl(e.target.value)}', replace: 'onChange={(v) => setUrl(v)}' },
  { search: 'onChange={(e) => setTopic(e.target.value)}', replace: 'onChange={(v) => setTopic(v)}' },
  { search: 'onChange={(e) => setTranscript(e.target.value)}', replace: 'onChange={(v) => setTranscript(v)}' },
  { search: 'onChange={(e) => setScrapeMix(Number(e.target.value))}', replace: 'onChange={(v) => setScrapeMix(Number(v))}' },
  { search: 'onChange={(e) => setEditedHook(e.target.value)}', replace: 'onChange={(v) => setEditedHook(v)}' },
  { search: 'onChange={(e) => setEditedVoiceover(e.target.value)}', replace: 'onChange={(v) => setEditedVoiceover(v)}' },
  { search: 'onChange={(e) => setBrands(e.target.value)}', replace: 'onChange={(v) => setBrands(v)}' },
  { search: 'onChange={(e) => setToolUrl(e.target.value)}', replace: 'onChange={(v) => setToolUrl(v)}' },
  { search: 'onChange={(e) => setKokoroApiUrl(e.target.value)}', replace: 'onChange={(v) => setKokoroApiUrl(v)}' },
  { search: 'onChange={(e) => setDuration(Number(e.target.value))}', replace: 'onChange={(v) => setDuration(Number(v))}' },
];

for (const {search, replace} of replacements) {
  // Replace globally just in case there are multiple
  content = content.split(search).join(replace);
}

fs.writeFileSync('app/page.tsx', content);
console.log('Fixed Input onChange');

import fs from 'fs';

let content = fs.readFileSync('app/page.tsx', 'utf-8');

// Replace Button variants
content = content.replace(/<Button([^>]*)variant="outline"([^>]*)>/g, '<Button$1color="secondary"$2>');
content = content.replace(/<Button([^>]*)variant="ghost"([^>]*)>/g, '<Button$1color="tertiary"$2>');
content = content.replace(/<Button([^>]*)variant="secondary"([^>]*)>/g, '<Button$1color="secondary"$2>');
content = content.replace(/<Button([^>]*)variant="destructive"([^>]*)>/g, '<Button$1color="primary-destructive"$2>');
content = content.replace(/<Button([^>]*)variant="default"([^>]*)>/g, '<Button$1color="primary"$2>');

// Remove size="icon" from Button since Untitled UI infers icon buttons from children
content = content.replace(/<Button([^>]*)size="icon"([^>]*)>/g, '<Button$1$2>');

// Replace onClick with onPress just to be safe with React Aria Components, wait, Untitled UI explicitly extended ButtonHTMLAttributes, so onClick works, but let's see. The error didn't complain about onClick. We will leave onClick as is.

fs.writeFileSync('app/page.tsx', content);
console.log('Fixed Button variants');

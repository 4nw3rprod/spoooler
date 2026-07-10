import fs from 'fs';

let content = fs.readFileSync('app/page.tsx', 'utf-8');

// Remove SelectTrigger, SelectValue, SelectContent
content = content.replace(/<SelectTrigger>[\s\S]*?<\/SelectTrigger>/g, '');
content = content.replace(/<SelectContent>/g, '');
content = content.replace(/<\/SelectContent>/g, '');

// Rename value= to id= in SelectItem
content = content.replace(/<SelectItem([^>]*) value=({[^}]+}|"[^"]+")/g, '<Select.Item$1 id=$2');
content = content.replace(/<\/SelectItem>/g, '</Select.Item>');
content = content.replace(/<SelectItem([^>]*)>/g, '<Select.Item$1>');

// Rename value= to selectedKey= in Select
content = content.replace(/<Select([^>]*) value=({[^}]+}|"[^"]+")/g, '<Select$1 selectedKey=$2');
content = content.replace(/<Select([^>]*) defaultValue=({[^}]+}|"[^"]+")/g, '<Select$1 defaultSelectedKey=$2');

// Fix the SelectItem import issue. Our refactor script used import {Select, SelectItem}
content = content.replace(/import {Select, SelectItem}/g, 'import {Select}');

fs.writeFileSync('app/page.tsx', content);
console.log('Select refactoring complete.');

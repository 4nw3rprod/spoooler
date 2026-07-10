import fs from 'fs';

let content = fs.readFileSync('app/page.tsx', 'utf-8');

// 1. Replace Imports
content = content.replace(/import {Button} from '@\/components\/ui\/button';/g, 'import {Button} from "@/components/base/buttons/button";');
content = content.replace(/import {Input} from '@\/components\/ui\/input';/g, 'import {Input} from "@/components/base/input/input";');
content = content.replace(/import {Label} from '@\/components\/ui\/label';/g, 'import {Label} from "@/components/base/input/label";');
content = content.replace(/import {Switch} from '@\/components\/ui\/switch';/g, 'import {Toggle as Switch} from "@/components/base/toggle/toggle";');
content = content.replace(/import {Textarea} from '@\/components\/ui\/textarea';/g, 'import {Textarea} from "@/components/base/textarea/textarea";');
content = content.replace(/import {Progress} from '@\/components\/ui\/progress';/g, 'import {ProgressBar as Progress} from "@/components/base/progress-indicators/progress-bar";');

// Tabs import
content = content.replace(
  /import {Tabs, TabsContent, TabsList, TabsTrigger} from '@\/components\/ui\/tabs';/g, 
  'import {Tabs} from "@/components/application/tabs/tabs";'
);

// Card import
content = content.replace(
  /import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@\/components\/ui\/card';/g,
  ''
);

// Select import (Untitled UI uses different Select API, we might need a shim or manually fix, but let's try simple replace first)
content = content.replace(
  /import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@\/components\/ui\/select';/g,
  'import {Select, SelectItem} from "@/components/base/select/select";'
);

// 2. Replace Tabs Components
content = content.replace(/<TabsList/g, '<Tabs.List');
content = content.replace(/<\/TabsList>/g, '</Tabs.List>');
content = content.replace(/<TabsTrigger value=/g, '<Tabs.Item id=');
content = content.replace(/<\/TabsTrigger>/g, '</Tabs.Item>');
content = content.replace(/<TabsContent value=/g, '<Tabs.Panel id=');
content = content.replace(/<\/TabsContent>/g, '</Tabs.Panel>');
content = content.replace(/<Tabs defaultValue=/g, '<Tabs defaultSelectedKey=');
content = content.replace(/<Tabs value=/g, '<Tabs selectedKey=');
content = content.replace(/onValueChange=/g, 'onSelectionChange=');

// 3. Replace Card Components (Simplifying to divs)
content = content.replace(/<Card>/g, '<div className="rounded-xl border border-secondary shadow-xs bg-primary p-6">');
content = content.replace(/<Card className="([^"]+)">/g, '<div className={`rounded-xl border border-secondary shadow-xs bg-primary p-6 ${"$1"}`}>');
content = content.replace(/<\/Card>/g, '</div>');

content = content.replace(/<CardHeader>/g, '<div className="mb-4">');
content = content.replace(/<CardHeader className="([^"]+)">/g, '<div className={`mb-4 ${"$1"}`}>');
content = content.replace(/<\/CardHeader>/g, '</div>');

content = content.replace(/<CardTitle>/g, '<h3 className="text-lg font-semibold text-primary">');
content = content.replace(/<\/CardTitle>/g, '</h3>');

content = content.replace(/<CardDescription>/g, '<p className="text-sm text-tertiary">');
content = content.replace(/<\/CardDescription>/g, '</p>');

content = content.replace(/<CardContent>/g, '<div>');
content = content.replace(/<CardContent className="([^"]+)">/g, '<div className="$1">');
content = content.replace(/<\/CardContent>/g, '</div>');

// Write back
fs.writeFileSync('app/page.tsx', content);
console.log('Refactoring complete.');

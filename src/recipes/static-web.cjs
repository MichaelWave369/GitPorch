// Fixed, dependency-free in-container recipe. Source files are data, never executed.
// Process must run with CWD = extracted trusted local Git source root.
'use strict';
const fs=require('node:fs');
const {TextDecoder}=require('node:util');
const path=require('node:path');
const decoder=new TextDecoder('utf-8',{fatal:true});
const MAX=96*1024;
function readRegular(name){
 const file=path.resolve(process.cwd(),name);
 const info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size>MAX)throw Error('Unsupported static-web input: '+name);
 return {data:decoder.decode(fs.readFileSync(file)),bytes:info.size};
}
function build(){
 const html=readRegular('docs/index.html');
 const css=readRegular('docs/styles.css');
 const js=readRegular('docs/app.js');
 if(html.bytes+css.bytes+js.bytes>MAX)throw Error('Static source exceeds 96 KiB');
 const style='<link rel="stylesheet" href="./styles.css">';
 const script='<script src="./app.js" defer></script>';
 if(html.data.split(style).length!==2||html.data.split(script).length!==2)
   throw Error('Fixed stylesheet/script references required exactly once');
 if(css.data.toLowerCase().includes('</style')||js.data.toLowerCase().includes('</script'))
   throw Error('Unsafe closing tag in inline asset');
 const output=html.data
   .replace(style,'<style data-gitporch-recipe="STATIC_WEB_ONEFILE_V1">\n'+css.data+'\n</style>')
   .replace(script,'<script data-gitporch-recipe="STATIC_WEB_ONEFILE_V1">\n'+js.data+'\n</script>');
 const bytes=Buffer.from(output,'utf8');
 if(bytes.length===0||bytes.length>128*1024)throw Error('Static output exceeds 128 KiB');
 process.stdout.write(JSON.stringify({schema:'gitporch-static-web-output/0.1',recipe:'STATIC_WEB_ONEFILE_V1',
   htmlBase64:bytes.toString('base64')})+'\n');
}
try{build()}catch(e){console.error('[Static recipe]',e.message);process.exitCode=1;}

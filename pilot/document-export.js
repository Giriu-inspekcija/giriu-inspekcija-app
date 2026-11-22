(() => {
  const cleanXml = text => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function docx(title, body) {
    const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const rel='http://schemas.openxmlformats.org/package/2006/relationships';
    const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const paragraphs=[title,'',...body.split(/\r?\n/)].map((line,i)=>
      '<w:p><w:r>'+(i===0?'<w:rPr><w:b/><w:sz w:val="30"/></w:rPr>':'')
      +'<w:t xml:space="preserve">'+cleanXml(line)+'</w:t></w:r></w:p>').join('');
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':'<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':'<w:document xmlns:w="'+word+'"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
    };
    const zip=window.fflate;
    const entries=Object.fromEntries(Object.entries(files).map(([key,value])=>[key,zip.strToU8(prefix+value)]));
    const blob=new Blob([zip.zipSync(entries)],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=title.replace(/[\\/:*?"<>|]/g,'-').slice(0,100)+'.docx';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function printDocument(title,body) {
    const printArea=document.getElementById('printDocument');
    const heading=document.createElement('h1'),content=document.createElement('div');
    heading.textContent=title;content.textContent=body;
    printArea.replaceChildren(heading,content);
    window.addEventListener('afterprint',()=>printArea.replaceChildren(),{once:true});
    window.print();
  }
  window.giDocumentExport={docx,printDocument};
})();

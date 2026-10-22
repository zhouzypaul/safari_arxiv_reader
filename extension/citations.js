function parts(name){if(name.includes(',')){const [family,...given]=name.split(',');return {family:family.trim(),given:given.join(',').trim()};}const tokens=name.trim().split(/\s+/);return {family:tokens.pop()||'',given:tokens.join(' ')};}
const initials=s=>s.split(/[\s-]+/).filter(Boolean).map(x=>x[0]+'.').join(' ');
export function citationFormats(p){
  const authors=(p.authorList||p.authors?.split(/; |, (?=[A-Z])/g)||[]).map(parts);
  const full=authors.map(a=>[a.given,a.family].filter(Boolean).join(' '));
  const inverted=authors.map(a=>a.family+(a.given?', '+initials(a.given):''));
  const join=(a,last='and')=>a.length>1?a.slice(0,-1).join(', ')+` ${last} `+a.at(-1):a[0]||'';
  const title=p.title||'Untitled',year=p.year||'n.d.',venue=p.venue||'',url=p.doi?'https://doi.org/'+p.doi:p.url||'',tail=[venue,url].filter(Boolean).join('. ');
  const safe=s=>String(s).replace(/[{}\\]/g,'');
  const key=(authors[0]?.family||'paper').replace(/\W/g,'')+year+title.split(/\W+/)[0];
  return {
    APA:`${join(inverted,'&')} (${year}). ${title}.${tail?' '+tail+'.':''}`,
    MLA:`${join(full)}. “${title}.” ${venue?venue+', ':''}${year}.${url?' '+url+'.':''}`,
    Chicago:`${join(full)}. “${title}.” ${venue?venue+' ':''}(${year}).${url?' '+url+'.':''}`,
    Harvard:`${join(inverted)} (${year}) ‘${title}’. ${tail}`,
    Vancouver:`${authors.map(a=>a.family+' '+initials(a.given).replace(/[. ]/g,'')).join(', ')}. ${title}. ${venue?venue+'. ':''}${year}.${url?' '+url:''}`,
    BibTeX:`@${p.arxiv?'misc':'article'}{${key},\n  title = {${safe(title)}},\n  author = {${authors.map(a=>safe(a.family+', '+a.given)).join(' and ')}},\n  year = {${year}}${venue?',\n  journal = {'+safe(venue)+'}':''}${p.doi?',\n  doi = {'+safe(p.doi)+'}':''}${p.arxiv?',\n  eprint = {'+safe(p.arxiv)+'},\n  archivePrefix = {arXiv}':''}${url?',\n  url = {'+safe(url)+'}':''}\n}`,
    RIS:['TY  - JOUR','TI  - '+title,...full.map(a=>'AU  - '+a),'PY  - '+year,venue?'JO  - '+venue:'',p.doi?'DO  - '+p.doi:'',url?'UR  - '+url:'','ER  - '].filter(Boolean).join('\n'),
    RefWorks:['RT Journal Article','SR Electronic',...full.map(a=>'A1 '+a),'T1 '+title,'YR '+year,venue?'JF '+venue:'',p.doi?'DO '+p.doi:'',url?'UL '+url:''].filter(Boolean).join('\n')+'\n\n',
    EndNote:['%0 Journal Article','%T '+title,...full.map(a=>'%A '+a),'%D '+year,venue?'%J '+venue:'',url?'%U '+url:''].filter(Boolean).join('\n')
  };
}

'use strict';
const menu=document.querySelector('.section-menu'),input=document.getElementById('section-search');
const mobile=matchMedia('(max-width:850px)');
menu.open=!mobile.matches;
mobile.addEventListener('change',()=>{menu.open=!mobile.matches;});
const links=[...menu.querySelectorAll('a[href^="#"]')];
input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();for(const link of links)link.closest('li').hidden=!link.textContent.toLowerCase().includes(query);document.getElementById('section-empty').hidden=links.some(link=>!link.closest('li').hidden);});
for(const link of links)link.addEventListener('click',()=>{const target=document.querySelector(link.getAttribute('href'));if(target){target.tabIndex=-1;target.focus({preventScroll:true});}if(mobile.matches)menu.open=false;});
const sections=links.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);
if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!visible)return;for(const link of links){if(link.getAttribute('href')==='#'+visible.target.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}},{rootMargin:'-10% 0px -65% 0px',threshold:0});for(const section of sections)observer.observe(section);}
document.getElementById('print-policy').addEventListener('click',()=>window.print());

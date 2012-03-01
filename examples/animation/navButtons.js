
var fixedButtons = false;

function checkNav(update) {
  var contents = document.querySelector("#contents");
  var rect = contents.getClientRects()[0];
  if (rect.top < 0) {
    if ((!fixedButtons) || (update && fixedButtons)) {
      var nav = document.querySelector("#navigation");
      nav.style["position"] = "fixed";
      nav.style["left"] = rect.left + "px";
      nav.style["width"] = rect.width + "px";
      fixedButtons = true;
    }
  } else if (rect.top >= 0 && fixedButtons) {
    var nav = document.querySelector("#navigation");
    nav.style["position"] = "absolute";
    nav.style["left"] = "0px";
    nav.style["width"] = "";
    fixedButtons = false;
  }
}

function checkNavAndPos() {
  checkNav(true);
}

var TOC = {
   "index.html": "Front page",
   "simple_example.html": "A simple example",
   "explicit_states.html": "Explicit state specification",
   "difference.html": "How is this different?",
   "keyframes.html": "Specifying keyframes",
   "shortest_path.html": "Animation paths",
   "generic_paths.html": "Generic paths",
          } 

function setTOC() {
  var path = window.location.pathname;
  var thisPage = path.substring(path.lastIndexOf("/") + 1);
  var tocString = "<ul>"
  var prev = undefined;
  var found = false;
  for (ref in TOC) {
    if (found) {
      createNextNav(ref);
      found = false;
    }
    if (ref == thisPage) {
      tocString += "<li><b>" + TOC[ref] + "</b></li>";
      if (prev) {
        createPrevNav(prev);
      }
      found = true;
    } else {
      tocString += "<li><a href=\"" + ref + "\">" + TOC[ref] + "</a></li>";
      prev = ref;
    }
  }
  tocString += "</ul>"

  var div = document.createElement("div")
  div.innerHTML = tocString;
  var nav = document.querySelector("#navigation");
  nav.parentElement.insertBefore(div, nav);
}

function createPrevNav(name) {
  createNav(name, "backward", "&lt;");
}

function createNextNav(name) {
  createNav(name, "forward", "&gt;");
}

function createNav(name, id, text) {
  var div = document.createElement("div");
  div.innerHTML = text;
  div.id = id;
  div.onclick = function() { window.location=name; }
  document.querySelector("#navigation").appendChild(div);
}

setTOC();

document.onscroll = checkNav;
window.onresize = checkNavAndPos;

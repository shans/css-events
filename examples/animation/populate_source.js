var styleElements = document.querySelectorAll("style");
for (var i = 0; i < styleElements.length; i++) {
  var style = styleElements[i];
  if (style.getAttribute("type") == "text/excss" && style.id) {
    var log = document.querySelector("#" + style.id + "_excss");
    if (log) {
      log.innerHTML = "<pre class='prettyprint lang-css'>" + style.innerHTML + "</pre>";
    }
  }
}

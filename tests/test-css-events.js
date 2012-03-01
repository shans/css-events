$(document).ready(function() {
  var arenaStyle = function() {
    return [].filter.call(document.styleSheets, function(ss) { return ss.ownerNode.id == "style-for-the-arena"; })[0];
  }

  var arena = $("#the-arena")[0];
  var setArenaStyle = function(text) { arenaStyle().ownerNode.innerHTML = text; };

  /**
   * Creates a phantom property name:value for the provided selector, then asserts that reading the property from the
   * provided object produces value. The provided object should be a jQuery-selected object.
   */
  var readWritePhantomProperty = function(testObject, selector, name, value) {
    CSSEmu.addPhantomStyle(selector, name, value);
    strictEqual(CSSEmu.currentStyle(testObject)[name], value, "accessed result matches set value");
  }

  var phantomPropertyIsUndefined = function(testObject, name) {
    strictEqual(CSSEmu.currentStyle(testObject)[name], undefined, "accessed result is undefined");
  }

  var curTmpId = 0;

  var createDiv = function() {
    var div = $(arena).append($("<div id='tmp" + (curTmpId++) + "'>Some inner content</div>")).children();
    div = div[div.length - 1];
    CSSEmu.addElementTree(div);
    return div;
  }

  var finished = function() { 
    $(arena).children().each(function(idx, node) { CSSEmu.removeElementTree(node); });
    $(arena).html($("")); 
    setArenaStyle("");
  }

  var styleMatches = function(style, check, reason) {
    if (!style) {
      ok(!check, reason + " is undefined");
      return;
    }
    for (var key in check) {
      strictEqual(style[key], check[key], reason + " " + key);
    }
  }  

  var styleStackMatches = function(actual, desired, reason) {
    strictEqual(actual.length, desired.length, reason + " depth");
    for (var i = 0; i < desired.length; i++) {
      strictEqual(actual[i].selectorText, desired[i].selector, reason + " " + i + " selector");
      styleMatches(actual[i].style, desired[i].style, reason + " " + i);
    }
  }

  var testEnv = function(initialDivs, initialCSS, captureGlobalEvents, localEventList, globalEventList, compareEvents, 
                         propFilter, selFilter, testFunction) {
    var divs = [];
    var capturedEventQueues = {};
    if (initialCSS) {
      setArenaStyle(initialCSS);
    }
    for (var i = 0; i < initialDivs.length; i++) {
      var classes = initialDivs[i].classes;
      var captureEvents = initialDivs[i].captureEvents;
      var div = createDiv();
      if (classes) {
        $(div).addClass(classes);
      }
      if (captureEvents) {
        (function avoidClosurePollution() {
          var capturedEvents = [];
          capturedEventQueues[captureEvents] = capturedEvents;
          for (var i = 0; i < localEventList.length; i++) {
            div[localEventList[i]] = function(event) { capturedEvents.push(event); };
          }
        })()
      }
      divs.push(div);
    }
    if (captureGlobalEvents) {
      var capturedEvents = [];
      capturedEventQueues[captureGlobalEvents] = capturedEvents;
      var handlers = [];
      for (var i = 0; i < globalEventList.length; i++) {
        handlers.push(window[globalEventList[i]](function(event) { capturedEvents.push(event); }, propFilter, selFilter));
      }
    }

    var results = testFunction(divs, capturedEventQueues);
    for (var key in results) {
      strictEqual(capturedEventQueues[key].length, results[key].length, "number of generated events");
      for (var i = 0; i < results[key].length; i++) {
        compareEvents(capturedEventQueues[key][i], results[key][i], "event " + i);
      }
    }   

    if (captureGlobalEvents) {
      for (var i = 0; i < globalEventList.length; i++) {
        var removeName = "remove" + globalEventList[i].substring(3);
        window[removeName](handlers[i]);
      }
    }
    finished();
  }

  var compareComputedStyleEvents = function(actual, desired, reason) {
    if (actual) {
      styleMatches(actual.oldStyle, desired.oldStyle, reason + " oldStyle");
      styleMatches(actual.newStyle, desired.newStyle, reason + " newStyle");
      strictEqual(actual.target, desired.target, reason + " target");
      for (var i = 0; i < desired.changedProperties.length; i++) {
        var property = desired.changedProperties[i];
        ok(actual.changedProperties.indexOf(property) >= 0, reason + " changedProperties contains " + property);
      }
    } else {
      ok(false, "no event generated");
    }
  } 

  var compareStyleRuleChangedEvents = function(actual, desired, reason) {
    if (actual) {
      styleMatches(actual.oldStyle, desired.oldStyle, reason + " oldStyle");
      styleMatches(actual.newStyle, desired.newStyle, reason + " newStyle");
      strictEqual(actual.target.selector.selectorText, desired.target, reason + " target");
    } else {
      ok(false, "no event generated");
    }
  };

  var compareMatchedCSSRulesEvents = function(actual, desired, reason) {
    styleStackMatches(actual.oldStyle, desired.oldStyle, reason + " oldStyle stack");
    styleStackMatches(actual.newStyle, desired.newStyle, reason + " newStyle stack");
    strictEqual(actual.target, desired.target, reason + " target");
  }

  var defaultLocalEvents = [];
  var defaultGlobalEvents = [];
  var defaultEventComparator = undefined;
  var defaultEventLists = function(local, global, comparator) {
    defaultLocalEvents = local;
    defaultGlobalEvents = global;
    defaultEventComparator = comparator;
  }   

  var simpleTest = function(name) {
    if (arguments.length == 3) {
      var dict = {};
      var testFunction = arguments[1];
      var isLocal = arguments[2];
    } else {
      var dict = arguments[1];
      var testFunction = arguments[2];
      var isLocal = arguments[3];
    }

    var cssText = dict["css"] || undefined;
    var classes = dict["classes"] || "";
    var propFilter = dict["propFilter"] || undefined;
    var selFilter = dict["selFilter"] || undefined;

    test(name, function() {
      var localEventList = dict["localEventList"] || defaultLocalEvents;
      var globalEventList = dict["globalEventList"] || defaultGlobalEvents;
      var eventComparator = dict["eventComparator"] || defaultEventComparator;
      
      var captureEvents = isLocal ? "eventQueue" : undefined;
      var gCaptureEvents = isLocal ? false : "eventQueue";
      testEnv([{classes: classes, captureEvents: captureEvents}], cssText, gCaptureEvents, localEventList, 
                globalEventList, defaultEventComparator, propFilter, selFilter, function(divs, events) {
        var result = testFunction(divs[0], events);
        if (!result) {
          return {eventQueue: []};
        }
        if (result.length) {
          return {eventQueue: result};
        }
        if (!result.target) { result.target = divs[0]; }
        return {eventQueue: [result]};
      });
    });
  }

  var multiDivTest = function(name, divs, dict, testFunction) {
    test(name, function() {
      var localEventList = dict.localEventList || defaultLocalEvents;
      var globalEventList = dict.globalEventList || defaultGlobalEvents;
      var eventComparator = dict.eventComparator || defaultEventComparator;
      
      testEnv(divs, dict.css, dict.globalQueue, localEventList, globalEventList, defaultEventComparator, 
              dict.propFilter, dict.selFilter, testFunction);
    });
  }

  var simpleLocalTest = function() { simpleTest.apply(null, [].slice.call(arguments).concat([true]));}
  var simpleGlobalTest = function() { simpleTest.apply(null, [].slice.call(arguments).concat([false]));}

  /* --------------- */

  module("phantom properties");

  test("create and read", function() {
    readWritePhantomProperty(arena, "#the-arena", "test-style", "larch");
    finished();
  });

  test("can create on constructed dom elements", function() {
    var div = createDiv();
    readWritePhantomProperty(div, "#the-arena div", "test-style-too", "larch-larch");    
    finished();
  });

  test("do not inherit", function() {
    var div = createDiv();
    readWritePhantomProperty(arena, "#the-arena", "another-style", "value");
    phantomPropertyIsUndefined(div, "another-style");
    finished();
  });
   
  module("onComputedStyleChanged", {
    setup: function() { defaultEventLists(["onComputedStyleChanged"], [], compareComputedStyleEvents); }
  });

  simpleLocalTest("triggered by CSS insertion", {classes: "test"}, function(div) {
    setArenaStyle(".test { color: green; }");
    return {oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(0, 128, 0)"}, changedProperties: ["color"]};
  });

  simpleLocalTest("triggered by class change", {css: ".test {color: red;}"}, function(div) {
    $(div).addClass("test"); 
    return {oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, changedProperties: ["color"]};
  });

  multiDivTest("triggered by class change (multiple divs)", 
               [{classes: "pretest", captureEvents: "a"}, {classes: "pretest", captureEvents: "b"}], 
               {css: ".test {color: red;}"}, function(divs) {
    $(".pretest").addClass("test");
    return {a: [{target: divs[0], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, 
                changedProperties: ["color"]}],
            b: [{target: divs[1], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, 
                changedProperties: ["color"]}]};
  });

  simpleLocalTest("triggered by direct manipulation of CSSOM", {classes: "test", css: ".test {color:red;}"}, function(div) {
    arenaStyle().rules[0].style["color"] = "blue";
    CSSEmu.styleSheetChanged(arenaStyle());
    return {oldStyle: {color: "rgb(255, 0, 0)"}, newStyle: {color: "rgb(0, 0, 255)"}, changedProperties: ["color"]};
  });

  simpleLocalTest("CSS changes without computedStyle changes don't trigger", 
                  {css: "#the-arena { color: red; }\n#the-arena div { color: green; }"},
                  function(div) {
    arenaStyle().rules[0].style["color"] = "blue";
    CSSEmu.styleSheetChanged(arenaStyle());
    return undefined;
  });  

  simpleLocalTest("new phantom properties trigger computedStyleChange events", function(div) {
    readWritePhantomProperty(div, "#the-arena div", "phantom", "property");
    return {oldStyle: {phantom: undefined}, newStyle: {phantom: "property"}, changedProperties: ["phantom"]};
  });

  simpleLocalTest("inherited style changes trigger computedStyle events", function(div) {
    setArenaStyle("#the-arena { color: red; }");
    return {oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, changedProperties: ["color"]};
  });

  module("addComputedStyleChangedHandler", {
    setup: function() {
      defaultEventLists(["onComputedStyleChanged"], ["addComputedStyleChangedHandler"], compareComputedStyleEvents);
    }
  });

  simpleGlobalTest("triggered by CSS insertion", {classes: "test"}, function() {
    setArenaStyle(".test { color: green; }");
    return {oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(0, 128, 0)"}, changedProperties: ["color"]};
  });

  simpleGlobalTest("triggered by class change", {css: ".test { color: red; }"}, function(div) {
    $(div).addClass("test"); 
    return {oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, changedProperties: ["color"]};
  });

  simpleGlobalTest("triggered by direct manipulation of CSSOM",
                   {classes: "test", css: "#the-arena {color: red; }"}, function(div) {
    arenaStyle().rules[0].style["color"] = "blue";
    CSSEmu.styleSheetChanged(arenaStyle());
    return [{target: arena, oldStyle: {color: "rgb(255, 0, 0)"}, newStyle: {color: "rgb(0, 0, 255)"}, 
            changedProperties: ["color"]},
            {target: div, oldStyle: {color: "rgb(255, 0, 0)"}, newStyle: {color: "rgb(0, 0, 255)"}, 
            changedProperties: ["color"]}];
  });

  simpleGlobalTest("CSS changes without computedStyle changes don't trigger", 
                   {css: "#the-arena { color: red; }\n#the-arena div { color: green; }"},
                   function(div) {
    arenaStyle().rules[0].style["color"] = "blue";
    CSSEmu.styleSheetChanged(arenaStyle());
    // there should be a captured event for the arena, but not for the child div
    return {target: arena, oldStyle: {color: "rgb(255, 0, 0)"}, newStyle: {color: "rgb(0, 0, 255)"}, changedProperties: ["color"]};
  });  

  simpleGlobalTest("can filter on properties", {classes: "test", propFilter: ["color", "width"]}, function(div, events) {
    setArenaStyle(".test { color: red;}");
    strictEqual(events["eventQueue"].length, 1, "an event generated");
    setArenaStyle(".test { color: red; width: 100px; background-color: green;}");
    strictEqual(events["eventQueue"].length, 2, "an event generated");
    setArenaStyle(".test { color: red; width: 100px; height: 400px;}");
    strictEqual(events["eventQueue"].length, 2, "no event generated");
    setArenaStyle(".test { color: blue; width: 100px; height: 100px;}");
    return [{target: div, oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, changedProperties: ["color"]},
            {target: div, oldStyle: {}, newStyle: {width: "100px"}, changedProperties: ["width"]},
            {target: div, oldStyle: {color: "rgb(255, 0, 0)", height: "400px"}, 
                             newStyle: {color: "rgb(0, 0, 255)", height: "100px"}, changedProperties: ["color", "height"]}];
  });

  simpleGlobalTest("can match filters on partial property names", {classes: "test", propFilter: ["*color"]}, function() { 
    setArenaStyle(".test { background-color: red;}");
    return {oldStyle: {"background-color": "rgba(0, 0, 0, 0)"}, newStyle: {"background-color": "rgb(255, 0, 0)"}, 
            changedProperties: ["background-color"]};
  });

  simpleGlobalTest("simple filters don't match partial property names", {classes: "test", propFilter: ["color"]}, function() { 
    setArenaStyle(".test { background-color: red;");
  });

  multiDivTest("can filter on selectors", [{classes: "a", captureEvents: "a"}, {classes: "b", captureEvents: "b"}], 
               {selFilter: ".a", globalQueue: "global"}, function(divs, events) {
    setArenaStyle("#the-arena div { color: green; }");
    return {a: [{target: divs[0], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(0, 128, 0)"}, 
                 changedProperties: ["color"]}], 
            b: [{target: divs[1], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(0, 128, 0)"}, 
                 changedProperties: ["color"]}],
            global: [{target: divs[0], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(0, 128, 0)"}, 
                      changedProperties: ["color"]}]};
  });
  

  multiDivTest("can filter on selectors and partial property names", [{classes: "a"}, {classes: "b"}],
               {selFilter: ".b", globalQueue: "global", propFilter: ["color"]}, function(divs, events) {
    setArenaStyle("#the-arena div { width: 100px;}");
    setArenaStyle(".a {color: green;}")
    strictEqual(events["global"].length, 0, "no events generated yet");  
    setArenaStyle("#the-arena div { color: red; width: 100px;}");
    return {global: [{target: divs[1], oldStyle: {color: "rgb(0, 0, 0)"}, newStyle: {color: "rgb(255, 0, 0)"}, 
                      changedProperties: ["color"]}]};
  });

      
  module("addStyleRuleChangedHandler", {
    setup: function() { defaultEventLists([], ["addStyleRuleChangedHandler"], compareStyleRuleChangedEvents); }
  });

  simpleGlobalTest("triggered by phantom property creation", function(div, events) {
    readWritePhantomProperty(arena, "#the-arena", "test-style", "larch");
    return {target: "#the-arena", oldStyle: {}, newStyle: {"test-style": "larch"}};
  });
 

  simpleGlobalTest("triggered by modification of phantom properties", function(div, events) {
    readWritePhantomProperty(arena, "#the-arena", "too-style", "larch");
    readWritePhantomProperty(arena, "#the-arena", "too-style", "nolarch");
    return [{target: "#the-arena", oldStyle: {"too-style": undefined}, newStyle: {"too-style": "larch"}},
            {target: "#the-arena", oldStyle: {"too-style": "larch"}, newStyle: {"too-style": "nolarch"}}];
  });
  
  simpleGlobalTest("receive information about multiple phantom properties", function(div, events) {
    readWritePhantomProperty(arena, "#the-arena", "foo", "7");
    readWritePhantomProperty(arena, "#the-arena", "bar", "42");
    readWritePhantomProperty(arena, "#the-arena", "far", "flim");
    readWritePhantomProperty(arena, "#the-arena", "bar", "forty two");
    return [{target: "#the-arena", oldStyle: {foo: undefined}, newStyle: {foo: "7"}},
            {target: "#the-arena", oldStyle: {foo: "7"}, newStyle: {foo: "7", bar: "42"}},
            {target: "#the-arena", oldStyle: {foo: "7", bar: "42"}, newStyle: {foo: "7", bar: "42", far: "flim"}},
            {target: "#the-arena", oldStyle: {foo: "7", bar: "42", far: "flim"}, 
                                                              newStyle: {foo: "7", bar: "forty two", far: "flim"}}];
  });

  multiDivTest("can filter by selector", [{classes: "a"}, {classes: "b"}], 
               {selFilter: ".a", globalQueue: "global"}, function(divs) {
    readWritePhantomProperty(divs[0], ".a", "position", "first");
    readWritePhantomProperty(divs[1], ".b", "position", "second");
    readWritePhantomProperty(divs[1], "#the-arena div", "position", "third");
    return {global: [{target: ".a", oldStyle: {position: undefined}, newStyle: {position: "first"}}]};
  });
  

  module("onMatchedCSSRulesChanged", {
    setup: function() { defaultEventLists(["onMatchedCSSRulesChanged"], [], compareMatchedCSSRulesEvents); }});

  simpleLocalTest("triggered by addition of matching rules", {css: ".test { color: red; } .moretest { background-color: green; }"}, 
                  function(div) {
    $(div).addClass("test");
    $(div).addClass("moretest");
    return [{target: div, oldStyle: [], newStyle: [{selector: ".test", style: {color: "red"}}]},
            {target: div, oldStyle: [{selector: ".test", style: {color: "red"}}], 
              newStyle: [{selector: ".test", style: {color: "red"}}, {selector: ".moretest", style: {"background-color": "green"}}]}];
  });

  simpleLocalTest("triggered by removal of matching rules", {css: ".test { color: red; } .moretest { background-color: green; }",
                  classes: "test moretest"}, function(div) {
    $(div).removeClass("test");
    $(div).removeClass("moretest");
    return [{target: div, 
             oldStyle: [{selector: ".test", style: {color: "red"}}, {selector: ".moretest", style: {"background-color": "green"}}], 
             newStyle: [{selector: ".moretest", style: {"background-color": "green"}}]},
            {target: div, oldStyle: [{selector: ".moretest", style: {"background-color": "green"}}], newStyle: []}];
  });
});

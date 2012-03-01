// Copyright 2011 Google Inc. All Rights Reserved.
//
// Use of this source code is governed by a BSD-type license.
// See the COPYING file for details.

/**
 * CSS event emulation (css-events).
 *
 * Provides emulated events for CSS changes. Events come in 4 flavours:
 * - events representing changes to the computedStyle of an element
 * - events representing changes to the set of property:value pairs of a CSSStyleRule
 *   [only implemented for phantom properties].
 * - events representing changes to the stack of CSSStyleRules that effect an
 *   element's style
 * - events representing changes to the set of elements selected by a
 *   CSSStyleRule [unimplemented]
 *
 * Also provides the ability to attach phantom properties (properties that are
 * not defined by CSS3) to style rules, and generates events for these properties.
 *
 * Please note that this library is very experimental. Some events may not be
 * detected, and performance is terrible :)
 *
 * Author: Shane Stephens <shans@chromium.org>
 */

(function(window) {
'use strict';

// set up environment
var document = window.document;
var exports = window.exports;
var console = window.console;

// extract debug flag from script tag
var isDebug = false;

if (document) {
  var allScripts = document.getElementsByTagName('script');
  var thisScript = allScripts[allScripts.length - 1];
  if (thisScript.getAttribute('debug') === 'true') {
    isDebug = true;
  }
}

// debug logs to the console if debug="true" is set on the script tag that imports this library
function debug(message) {
  if (isDebug) {
    console.log("css-events:" + message);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Data Structures
////////////////////////////////////////////////////////////////////////////////

// 
// ElementRef
//
// Each ElementRef tracks a single element contained in the DOM, caching
// matched rules and computed style.  ElementRefs also store registered
// handlers for ComputedStyleChanged and MatchedCSSRulesChanged events.
function ElementRef(element) {
  this.element = element;
  this.matchedRules = [];
  this.onComputedStyleChanged = undefined;
  this.onMatchedCSSRulesChanged = undefined;

  // When a phantom style is added to a selector, computedStyleChanged handlers 
  // registered on this element may need to be called with new style information.
  //
  // TODO:  This generates fake computedStyles representing only the phantom style
  // for oldStyle and newStyle. It should deliver a complete style record instead.
  this.triggerEventsFromPhantomStyleChange = function(selector, name, value) {
    debug("triggering phantom events for " + selector + " " + name + ":" + value + 
          " for object " + element.id);

    // no ned to trigger handler as observed style hasn't changed.
    if (this.computedStyle[name] == value) {
      return;
    }

    // Generate a fake style representing the computedStyle for the phantom style
    // before the change.
    var oldStyle = {}
    oldStyle[name] = this.computedStyle[name];
    this.computedStyle[name] = value;
    

    // Generate a fake style representing the computedStyle for the phantom style
    // after the change.
    var newStyle = {}
    newStyle[name] = value;

    this.callComputedStyleChanged({target: element, oldStyle: oldStyle,  newStyle: newStyle,
                                   changedProperties: [name]});
  }

  // Emulates event bubbling for MatchedCSSRulesChanged events.
  //
  // TODO: Implement cancellation of bubbling.
  this.callMatchedCSSRulesChanged = function(event) {
    if (this.onMatchedCSSRulesChanged) {
      this.onMatchedCSSRulesChanged(event);
    }
    if (this.element.parentElement && this.element.parentElement.id != "") {
      elements[this.element.parentElement.id].callMatchedCSSRulesChanged(event);
    }
  }

  // Emulates event bubbling for ComputedStyleChanged events, including
  // passing out to global handlers once the document element is reached.
  //
  // TODO: Implement cancellation of bubbling.
  this.callComputedStyleChanged = function(event) {
    if (this.onComputedStyleChanged) {
      this.onComputedStyleChanged(event);
    }
    if (this.element.parentElement && this.element.parentElement.id != "") {
      elements[this.element.parentElement.id].callComputedStyleChanged(event);
    } else {
      callComputedStyleChangedHandlers(event);
    }
  }

  // Manually constructs style from the set of matched rules for this element.
  // This is necessary to avoid exposing animation style when servicing handlers.
  this.reconstructStyleFromRules = function(style) {
    for (var i = 0; i < this.matchedRules.length; i++) {
      var rule = this.matchedRules[i];
      accum(style, rule.style);
    }
    return style;
  }
 
  // Returns the current style for this element, taking phantom styles into account.
  this.currentStyle = function() {
    var style = copyStyle(window.getComputedStyle(this.element));
    cssRules.computePhantomStyles(style, this.element);
    return style;
  }

  this.computedStyle = this.currentStyle();

  // Update the matched rules and computedStyle for this element and call
  // relevant handlers if a change has occurred.
  this.updateStyle = function() {
    var oldStyle = this.matchedRules;
    this.matchedRules = copyRuleList(window.getMatchedCSSRules(element));
    // TODO: make this take phantom rules into account too
    var changed = false;
    if (oldStyle.length != this.matchedRules.length) {
      changed = true;
    } else {
      for (var i = 0; i < oldStyle.length; i++) {
        if (!(compareRules(oldStyle[i], this.matchedRules[i]))) {
          changed = true;
          continue;
        }
      }
    }
    if (changed) {
      this.callMatchedCSSRulesChanged(
        {target: element, oldStyle: oldStyle, newStyle: this.matchedRules});
    }

    var newProps = this.currentStyle();
    var oldProps = this.computedStyle;
    this.computedStyle = newProps;
    var changedProperties = []

    for (var prop in newProps) {
      if (!(prop in oldProps) || ((prop in oldProps) && (newProps[prop] != oldProps[prop]))) {
        changedProperties.push(prop);
      }
    }
    for (var prop in oldProps) {
      if (!(prop in newProps)) {
        changedProperties.push(prop);
      }
    }
    if (changedProperties.length > 0) {
      this.callComputedStyleChanged({target: element, oldStyle: oldProps, newStyle: newProps, 
                                     changedProperties: changedProperties});
    }
  }

  // Newly constructed elements should update their style in order to generate
  // initial callbacks.
  this.updateStyle();
}

// We need to be able to track the text order of style rules on a
// sheet-by-sheet basis in order to correctly resolve style rules to
// computedStyles.  This dictionary stores a monotonically increasing index for
// each encountered sheet.
var _text_order = {};

function nextTextIndexForSheet(sheet) {
  if (!(sheet in _text_order)) {
    _text_order[sheet] = 0;
  } 
  return _text_order[sheet]++;
}

var phantomStyleSheet = {index: Infinity};

//
// CssRuleRef
//
// Each CssRuleRef represents a single CSS rule on the current page. Additional
// rules are generated for phantom styles (TODO: allow phantom styles to be
// added to existing rules too).
function CssRuleRef(selector, style, sheet, phantom) {
  // This rule's selector.
  this.selector = selector;

  // This rule's current style
  if (phantom) {
    this.style = style;
  } else {
    this.style = copyStyle(style);
  }

  // The sheet this rule comes from.
  this.sheet = sheet;

  // True if this is a phantom rule.
  this.phantom = phantom || false;

  // An indice indicating position within this rule's sheet.
  this.textOrder = nextTextIndexForSheet(sheet);

  // Returns true if this is a phantom rule.
  this.isPhantom = function() { return this.phantom; }
}

// 
// SelectorRef
//
// SelectorRefs track sets of CssRuleRefs with a common selector, along with
// StyleRuleChanged handlers that are defined at the selector level.
function SelectorRef(selector) {

  // The selector text shared by all of the tracked CssRuleRefs.
  this.selectorText = selector;

  // The tracked CssRuleRefs.
  this.rules = [];

  // StyleRuleChanged handler that is defined at the selector level.
  // TODO: Track multiple handlers per selector, as these are defined
  // via the addStyleRuleChangedHandler interface on window.
  this.handler = undefined;

  // Adds a new CssRule to be tracked by the library. Calls a locally
  // installed StyleRuleChanged handler if present. Cascades to global
  // StyleRuleChanged handlers. Calls updateElement to allow tracked
  // elements to generate ComputedStyleChanged and MatchedCSSRuleChanged
  // events.
  this.addRule = function(style, sheet) {
    debug("registering new rule for selector " + this.selectorText);
    var newRule = this.rules.push(new CssRuleRef(this, style, sheet));
    var event = {target: style, oldStyle: null, newStyle: this.rules[this.rules.length - 1]};
    if (this.handler) {
      debug("calling handler installed for " + this.selectorText + " while adding new rule");
      this.handler(event);
    }
    callStyleRuleChangedHandlers(event);
    [].forEach.call(document.querySelectorAll(this.selectorText), updateElement);
  }

  // Adds a phantom rule to a new CssRuleRef attached to this selector. Calls
  // a locally installed StyleRuleChanged handler if present. Cascades to
  // global StyleRuleChanged handlers. Calls updateElement to allow
  // tracked elements to generate ComputedStyleChanged and MatchedCSSRuleChanged
  // events.
  // TODO: implement property filtering when calling StyleRuleChanged handler
  this.addPhantomRule = function(name, value) {
    var pStyle = {}
    pStyle[name] = value;
    var oldStyle = this.computePhantomStyles();
    this.rules.push(new CssRuleRef(this, pStyle, phantomStyleSheet, true));
    var newStyle = this.computePhantomStyles();
    var event = {target: this.rules[this.rules.length - 1], oldStyle: oldStyle, newStyle: newStyle};
    if (this.handler) {
      this.handler(event);
    }
    callStyleRuleChangedHandlers(event);
    [].forEach.call(document.querySelectorAll(this.selectorText), updateElement);
  }

  // Sets the StyleRuleChanged handler for this selector.
  // TODO: implement property filtering
  // TODO: implement handler multiplexing
  this.addStyleRuleChangedHandler = function(handler, properties) {
    this.handler = handler;
  }

  // Removes the StyleRuleChanged handler for this selector.
  this.removeStyleRuleChangedHandler = function(handler) {
    this.handler = undefined;
  }

  // Calculates the specificity of the provided selector string. This is a fairly
  // quick-and-dirty approach but seems to work reasonably well.
  this.calculateSpecificity = function(selector) {
    var components = selector.split(/[\b+>]+/);
    var b = 0;
    var c = 0;
    var d = 0;
    for (var i = 0; i < components.length; i++) {
      if (components[i][0] == "#") {
        b += 1;
      } else if (components[i][0] == ".") {
        c += 1;
      } else if (components[i][0] != "[" && components[i][0] != ":") {
        d += 1;
      }

      d += components[i].split(":").length - 1;
      c += components[i].split("[").length - 1;
    }
    return [b,c,d];
  }

  // Calculate and store specificity on object creation.
  this.specificity = this.calculateSpecificity(selector);

  // Computes the effect of this selector's phantom styles
  // on elements that match this selector by sorting 
  // rules in sheet and text order and applying the styles
  // to a dictionary.
  this.computePhantomStyles = function() {
    var style = {}
    var rules = this.rules.filter(function(rule) { return rule.isPhantom(); });
    rules.sort(function(a, b) {
      if (a.sheet.index > b.sheet.index) {
        return 1;
      } else if (a.sheet.index < b.sheet.index) {
        return -1;
      } else {
        if (a.textOrder > b.textOrder) {
          return 1;
        } else if (a.textOrder < b.textOrder) {
          return -1;
        } else {
          return 0;
        }
      }
    });
    rules.forEach(function(rule) { accum(style, rule.style); });
    return style;
  }

  // Removes all rules originating from the provided sheet.
  this.killRulesFromSheet = function(sheet) {
    this.rules = this.rules.filter(function(rule) { return rule.sheet != sheet });
  }
}

// 
// CssRules
//
// A singleton object that stores all tracked CssRules, sorted by selector text.
function CssRules() {
  this.cssRules = {}

  // Returns the SelectorRef associated with the provided selector, creating one
  // if necessary.
  this.getSelectorRef = function(selector) {
    if (!(selector in this.cssRules)) {
      this.cssRules[selector] = new SelectorRef(selector);
    }
    return this.cssRules[selector];
  }

  // Adds the provided rule to the tracked rules, associating the rule with
  // the provided style sheet.
  this.addRule = function(style, sheet) {
    var selector = style.selectorText;
    this.getSelectorRef(selector).addRule(style, sheet);
  }

  // Computes style contributions from phantom styles and accumulates
  // into the provided style dictionary. Requires the provision of
  // the object for which the style is to be computed so that attr()
  // references can be resolved.
  this.computePhantomStyles = function(style, object) {
    var selectors = [];
    for (var selector in this.cssRules) {
      if (object.webkitMatchesSelector(selector)) {
        selectors.push(this.cssRules[selector]);
      }
    }
    selectors.sort(function(a, b) {
      if (a.specificity < b.specificity) { return -1 }
      else if (a.specificity > b.specificity) { return 1 }
      return 0;
    });
    selectors.forEach(function(selector) {
      accumWithAttrSubstitution(object, style, selector.computePhantomStyles());
    });
  }

  // Creates a phantom rule consisting of the provided property name and
  // value for the provided selector. This has the effect of creating a 
  // new CssRule with just one entry in a stylesheet that is after every
  // other sheet on the page.
  this.addPhantomRule = function(selector, name, value) {
    this.getSelectorRef(selector).addPhantomRule(name, value);
    // trigger any event handlers registered on elements
    [].forEach.call(document.querySelectorAll(selector), function(element) {
      if (element.id in elements) {
        elements[element.id].triggerEventsFromPhantomStyleChange(selector, name, value);
      }
    });
  }

  // Adds a handler for StyleRuleChanged events to the provided selector,
  // filtering on the provided properties.
  this.addStyleRuleChangedHandler = function(selector, handler, properties) {
    this.getSelectorRef(selector).addStyleRuleChangedHandler(handler, properties);
  }

  // Removes a handler for StyleRuleChanged events from the provided selector.
  this.removeStyleRuleChangedHandler = function(selector, handler) {
    this.getSelectorRef(selector).removeStyleRuleChangedHandler(handler);
  }

  // Removes tracking objects for all rules on the provided sheet.
  this.killRulesFromSheet = function(sheet) {
    for (var selector in this.cssRules) {
      this.cssRules[selector].killRulesFromSheet(sheet);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// Data
////////////////////////////////////////////////////////////////////////////////

var cssRules = new CssRules(); 

var elements = {}

////////////////////////////////////////////////////////////////////////////////
// Utilities
////////////////////////////////////////////////////////////////////////////////

// Runs the provided function on the provided element and all elements in the
// provided element's subtree.
function onSubtree(element, f) {
  var walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, null, false);
  do {
    f(walker.currentNode);
  } while (walker.nextNode());
}

// Copies a style dictionary (i.e. a dictionary of property name:value entries)
function copyStyle(inStyle) {
  var style = {}
  for (var i = 0; i < inStyle.length; i++) {
    style[inStyle[i]] = inStyle[inStyle[i]];
  }
  return style;
}

// Copies a rule (i.e. an object with selectorText and style properties)
function copyRule(obj) {
  if (obj.style) {
    return { selectorText: obj.selectorText, style: copyStyle(obj.style) };
  }
  return obj;
}

// Copies a list of rules.
function copyRuleList(list) {
  var newList = [];
  if (!list) {
    return newList;
  }
  for (var i = 0; i < list.length; i++) {
    newList.push(copyRule(list[i]));
  }
  return newList;
}

// Compares two rules and returns true if they match in selector and style.
function compareRules(a, b) {
  if (a.selectorText != b.selectorText) {
    return false;
  }
  for (var key in a.style) {
    if (a[key] != b[key]) {
      return false;
    }
  }
  for (key in b.style) {
    if (!(key in a.style)) {
      return false;
    }
  }
  return true;
}

// Accumulates the provided values into the provided map, overwriting
// existing values with the same key.
function accum(map, newValues) {
  for (var o in newValues) {
    map[o] = newValues[o];
  }
}

// Accumulates the provided values into the provided map, overwriting
// existing values with the same key. If one of the provided values
// is an attr(...) reference, looks up the relevant attribute from
// the provided object and uses this as the value.
function accumWithAttrSubstitution(object, map, newValues) {
  for (var o in newValues) {
    var value = newValues[o]
    if (value.substring(0, 5) == "attr(") {
      var attr = value.substring(5, value.length - 1);
      value = object.getAttribute(attr);
    }
    map[o] = value;
  }
}

////////////////////////////////////////////////////////////////////////////////
// Method Interception
////////////////////////////////////////////////////////////////////////////////

function styleSheetChanged(sheet) {
  cssRules.killRulesFromSheet(sheet);
  initStyleSheet(sheet);
}

// Replacement for the native .innerHTML and .innerText setters
// for style nodes. Determines the sheet index of the node, applies
// the effect of the setter, and calls initStyleSheet
// to maintain consistency of tracking data structures.
// TODO We could be more efficient about this if necessary
function setStyleText(text) {
  var index;
  var sheet;
  for (var i = 0; i < document.styleSheets.length; i++) {
    if (document.styleSheets[i].ownerNode.id == this.id) {
      sheet = document.styleSheets[i];
      index = sheet.index;
      break;
    }
  }
  debug("set style text for style sheet " + this.id + " at index " + index)
  while (this.firstChild) { this.removeChild(this.firstChild); }
  this.appendChild(document.createTextNode(text));
  this.innerTextShadow = text;
  if (sheet) {
    cssRules.killRulesFromSheet(sheet);
  }
  if (sheet) {
    for (var i = 0; i < document.styleSheets.length; i++) {
      if (document.styleSheets[i].ownerNode == sheet.ownerNode) {
        sheet = document.styleSheets[i];
        break;
      }
    }
  } else {
    for (var i = 0; i < document.styleSheets.length; i++) {
      if (document.styleSheets[i].index == undefined) {
        sheet = document.styleSheets[i];
        break;
      }
    }
  }
  initStyleSheet(sheet);
}

// Replacement for native .innerHTML and .innerText getters
// for style nodes.
function getStyleText() {
  return this.innerTextShadow;
}

// Replaces native setAttribute for provided element with a version
// that also reports an event for CSS Event generation.
function interceptSetAttribute(element) {
  element._real_setAttribute = element.setAttribute;
  element.setAttribute = function(name, value) {
    element._real_setAttribute(name, value);
    handleEvent({target: element})
  }
  // Also need to intercept class and className setters and getters
  element.__defineSetter__("class", function(value) { element.setAttribute("class", value); });
  element.__defineSetter__("className", function(value) { element.setAttribute("class", value); });
  element.__defineGetter__("class", function() { return element.getAttribute("class"); });
  element.__defineGetter__("className", function() { return element.getAttribute("class"); });
}


////////////////////////////////////////////////////////////////////////////////
// Window Level Handlers
////////////////////////////////////////////////////////////////////////////////

var styleRuleChangedHandlers = [];

// Calls all registered global StyleRuleChanged handlers with the provided event.
// TODO: implement property filtering
function callStyleRuleChangedHandlers(event) {
  for (var i = 0; i < styleRuleChangedHandlers.length; i++) {
    if (styleRuleChangedHandlers[i]) {
      styleRuleChangedHandlers[i].handler(event);
    }
  }
}

// Adds a StyleRuleChanged handler to the relevant SelectorRef, or to the global
// list if no selector is provided.
function addStyleRuleChangedHandler(handler, properties, selector) {
  if (selector) {
    var idx = cssRules.addStyleRuleChangedHandler(selector, handler, properties);
    return [selector, idx];
  } else {
    styleRuleChangedHandlers.push({ handler: handler, properties: properties });
    return styleRuleChangedHandlers.length - 1;
  }
}

function removeStyleRuleChangedHandler(idx) {
  if (typeof idx == "number") {
    delete styleRuleChangedHandlers[idx];
  } else {
    cssRules.removeStyleRuleChangedHandler(idx[0], idx[1]);
  }
}

var computedStyleChangedHandlers = [];

// 
// ComputedStyleChangedHandler
//
// Represents a registered ComputedStyleChanged handler. Performs filtering
// of potential callbacks based on provided selector and properties of 
// interest.
function ComputedStyleChangedHandler(handler, properties, selector) {
  this.handler = handler;
  this.properties = properties || ["*"];
  this.selector = selector || "*";
 
  // Returns true if the provided property matches the provided specification.
  this.matches = function(property, propertySpec) {
    var re = eval("/^" + propertySpec.replace(/\*/g, ".*") + "$/");
    return re.exec(property) != null;
  }
 
  // Check whether the event matches this handler's filter selector, and 
  // whether any properties in the event match any of this handler's filter
  // properties. If both match then call this handler.
  this.maybeCall = function(event) {
    if (!event.target.webkitMatchesSelector(this.selector)) {
      return;
    }
    for (var i = 0; i < this.properties.length; i++) {
      for (var j = 0; j < event.changedProperties.length; j++) {
        if (this.matches(event.changedProperties[j], this.properties[i])) {
          this.handler(event);
          return;
        }
      }
    }

  }
}

// Calls all global ComputedStyleChanged handlers with the provided event.
function callComputedStyleChangedHandlers(event) {
  for (var i = 0; i < computedStyleChangedHandlers.length; i++) {
    if (computedStyleChangedHandlers[i]) {
      computedStyleChangedHandlers[i].maybeCall(event);
    }
  }
}

// Adds a new ComputedStyleChanged handler to the global list.
function addComputedStyleChangedHandler(handler, properties, selector) {
  var handler = new ComputedStyleChangedHandler(handler, properties, selector);
  computedStyleChangedHandlers.push(handler);
  return computedStyleChangedHandlers.length - 1;
}

function removeComputedStyleChangedHandler(idx) {
  delete computedStyleChangedHandlers[idx];
}

////////////////////////////////////////////////////////////////////////////////
// Event Handling
////////////////////////////////////////////////////////////////////////////////

// Calls updateStyle on the provided element and all its subelemeents.
function updateElement(element) {
  onSubtree(element, function(node) {
    if (node.id == "") {
      return;
    }
    if (node.id in elements) {
      elements[node.id].updateStyle();
    }
  });
}

// Responds to the provided event by updating all relevant style information.
// TODO: be a lot smarter about this and hopefully improve performance :)
function handleEvent(event) {
  if (event.target) {
    updateElement(event.target);
  }
  if (event.relatedTarget) {
    updateElement(event.relatedTarget);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Initialization
////////////////////////////////////////////////////////////////////////////////

var upTo;

// Creates a new unique id for use with elements.
function generateNewId() {
  if (upTo == undefined) {
    upTo = 0;
  }
  upTo += 1;
  return "__element_id_for_animation__" + String(upTo);
}

// Adds the subtree rooted at the provided element to be tracked by the library.
// Also installs alternative innerText and innerHTML setters and getters for 
// style nodes, and alternative setAttribute methods for all nodes.
function addElementTree(element) {
  onSubtree(element, function(node) {
    if (node.id == "") {
      node.id = generateNewId();
    }
    if (node.tagName == "STYLE") {
      node.innerTextShadow = node.innerText;
      node.__defineSetter__("innerText", setStyleText);
      node.__defineSetter__("innerHTML", setStyleText);
      node.__defineGetter__("innerText", getStyleText);
      node.__defineGetter__("innerHTML", getStyleText);
    }
    if (!(node.id in elements)) {
      elements[node.id] = new ElementRef(node);
      node.__defineSetter__("onComputedStyleChanged", function(handler) {
        elements[this.id].onComputedStyleChanged = handler;
      });
      node.__defineSetter__("onMatchedCSSRulesChanged", function(handler) {
        elements[this.id].onMatchedCSSRulesChanged = handler;
      });
      interceptSetAttribute(node);
    }
  });
}

function removeElementTree(element) {
  onSubtree(element, function(node) {
    if (node.id in elements) {
      delete elements[node.id];
    }
  });
}

var sheetIndex = 0;

// Adds the provided stylesheet to be tracked by the library.
function initStyleSheet(styleSheet) {
  styleSheet.index = sheetIndex++;
  if (styleSheet.cssRules) {
    [].forEach.call(styleSheet.cssRules, function(cssRule) {
      if (cssRule.constructor == CSSStyleRule) {
        cssRules.addRule(cssRule, styleSheet);
      }
    });
  }
} 

// Adds all style sheets on the page to be tracked by the library.
function initStyles() {
  [].forEach.call(document.styleSheets, initStyleSheet);
}

// A class that, when instantiated, redirects the provided event on 
// the provided object so that the provided function is called before
// the event handler. 
function EventRedirector(obj, evt, fun) {
  this.obj = obj;
  this.evt = evt;
  this.fun = fun;
  this.oldFun = obj[evt];

  this.handler = function(event) {
    this.fun(event);
    if (this.oldFun instanceof Function) {
      this.oldFun(event);
    }
  }

  obj[evt] = this.handler.bind(this);
}

// Performs all initialization tasks for the library.
function init() {

  initStyles();
  addElementTree(document.documentElement);

  // Redirect all events that might trigger a style change.
  new EventRedirector(document, "DOMSubtreeModified", handleEvent);
  new EventRedirector(document.documentElement, "onclick", handleEvent);
  new EventRedirector(document.documentElement, "onmouseover", handleEvent);
  new EventRedirector(document.documentElement, "onmouseout", handleEvent);
  new EventRedirector(document.documentElement, "onmousedown", handleEvent);
  new EventRedirector(document.documentElement, "onmouseup", handleEvent);

  window.addStyleRuleChangedHandler = addStyleRuleChangedHandler;
  window.removeStyleRuleChangedHandler = removeStyleRuleChangedHandler;
  window.addComputedStyleChangedHandler = addComputedStyleChangedHandler;
  window.removeComputedStyleChangedHandler = removeComputedStyleChangedHandler;
}

init();

////////////////////////////////////////////////////////////////////////////////
// Globals
////////////////////////////////////////////////////////////////////////////////

// Note that there are additional event-handler registration points exposed
// on DOM elements directly, as well as on the window object. These methods
// represent additional functionality that does not tie into the event system.

// Adds a phantom CssRule with just the provided name:value mapping and selector.
function addPhantomStyle(selector, name, value) {
  cssRules.addPhantomRule(selector, name, value);
}

// Returns the current style of the provided element, taking phantom styles into account.
function currentStyle(element) {
  var style = elements[element.id].currentStyle();
  return style;
}

if (!window.CSSEmu) {
  window.CSSEmu = {
    addPhantomStyle: addPhantomStyle,
    currentStyle: currentStyle,

    // TODO: Automate these three functions and remove from the API
    addElementTree: addElementTree,
    removeElementTree: removeElementTree,
    styleSheetChanged: styleSheetChanged,
  
    Util: {
      copyStyle: copyStyle,
      copyRule: copyRule
    }
  }
}

}(window));

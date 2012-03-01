// Copyright 2011 Google Inc. All Rights Reserved.
//
// Use of this source code is governed by a BSD-type license.
// See the COPYING file for details.

/**
 * Declarative transitions & animations extension support.
 * 
 * Uses CSSEmu library to detect changes in CSS state.
 * Uses excss library to parse extended CSS syntax.
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
    if (typeof message == "function") {
      message = message();
    }
    console.log("ExcssAnimation:" + message);
  }
}

////////////////////////////////////////////////////////////////////////////////
// Data Structures
////////////////////////////////////////////////////////////////////////////////

//
// Animation
//
// Represents a single state-based animation graph attached to a single element.
function Animation(animations, element, property) {
  // The current instantaneous state. Changes immediately when state change 
  // triggers occur.
  this.instantaneousState = undefined;
  
  // The destination state of the current animation. Changes when the current animation 
  // ends, to a state based on a shortest-path algorithm, until it matches the 
  // instantaneousState. A difference between animDestState and instantaneousState indicates
  // a new animation segment needs to be generated.
  this.animDestState = undefined;

  // The element to which this animation applies.
  this.element = element;

  // The property that tracks state for this animation.
  this.property = property;

  // True if an animation is currently running for this animation.
  this.animInProgress = false;

  // Backref to parent object.
  this.animations = animations;
  
  // Sets the source style for animating from this animation's element's current style.
  this.setStyleFromObject = function() {
    this.fromStyle = this.getStyleFromObject();
  }

  // Returns a copy of the current style of this animation's element.
  this.getStyleFromObject = function() {
    return CSSEmu.Util.copyStyle(window.getComputedStyle(this.element));
  }

  // Sets the current state to the provided name. This may trigger an 
  // animation.
  this.setCurrentState = function(name) {
    if (!this.animDestState) {
      this.animDestState = name;
      this.instantaneousState = name;
      // If there is explicit style information for this state in the @transition-graph
      // we need to update the style of the object to reflect it.
      this.animations.updateExplicitStyles();
      this.setStyleFromObject();
      debug("init " + name + " for object " + this.element.id);
    } else if (name != this.instantaneousState) {
      debug("to " + name);
      this.instantaneousState = name;
      this.animations.updateExplicitStyles();
      // TODO: is this path ever exercized?
      if (this.element.webkitGetAnimations) {
        var anims = this.element.webkitGetAnimations();
        if (this.animInProgress && (!anims || anims.length == 0)) {
          console.log("FORCED ANIMATION TERMINATION FOR " + this.element.id);
          this.animationEnded();
        }
      }
      if (!this.animInProgress) {
        this.maybeStartAnimating();
      }
    }
  }

  // Called when the current animation for this graph is terminated.
  this.animationEnded = function() {
    this.animInProgress = false;
    this.element.setAttribute(this.property + "_anim", "");
    this.maybeStartAnimating();
  }

  // Generates an @-webkit-keyframes set from the provided from state to the 
  // provded to state, naming the set using the provided name, using the provided
  // template and substituting from() and to() refs with actual values.
  this.generateKeyframe = function(from, to, name, template) {
    if (!from) {
      return "";
    }
    to = to || from;
    var result = "@-webkit-keyframes ".concat(name, " {\n");
    template.blocks.forEach(function(block) {
      // Add selectors and opening brace.
      result = result.concat("  ", block.selector, " {\n");
      // Generate keyframe properties, substituting where from() or to() functions
      // are encountered.
      var properties = []
      block.rules.forEach(function(rule) {
        var decl = rule.declaration;
        var raw = decl.split(":").map(function(a) { return a.trim(); });
        if (raw[1] == "from()") {
          longhandFor([raw[0]]).forEach(function(prop) {
            properties.push(prop.concat(": ", from[prop]));
          });
        } else if (raw[1] == "to()") {
          longhandFor([raw[0]]).forEach(function(prop) {
            properties.push(prop.concat( ": ", to[prop]));
          });
        } else {
          properties.push(decl);
        }
      });
      properties.forEach(function(property) {
        result = result.concat("    ", property, ";\n");
      });
      result = result.concat("  }\n");
    });
    return result.concat("}\n");
  }


  // Generates a keyframe endpoint from the provided style
  // and properties.
  this.generateEndPoint = function(style, over) {
    var result = "";
    for (var i = 0; i < over.length; i++) {
      var value = style[over[i]];
      result += "    " + over[i] + ": " + value + ";\n";
    }
    return result;
  }

  // Starts a new animation, as long as we haven't reached our current instantaneous state
  // and there isn't currently an animation in progress.
  this.maybeStartAnimating = function() {
    if (!this.animInProgress && this.animDestState != this.instantaneousState) {
      var graph = animationSelectors.graphForObject(this.element, this.property);
      var path = graph.shortestPath(this.animDestState, this.instantaneousState);

      // If there is no direct shortest path from out current animation state to
      // our current instantaneous state then we need to fall back on generic
      // paths.
      var fromStar = false;
      var to = "*";
      if (!path || path.length == 0) {
        // First try from the current state to "*".
        var link = graph.lookupEdge(this.animDestState, "*");
        if (!link) {
          // Then from "*" to the instantaneous state.
          link = graph.lookupEdge("*", this.instantaneousState);
          fromStar = true;
          to = this.instantaneousState;
        }
        if (!link) {
          // Finally try from "*" to "*"
          link = graph.lookupEdge("*", "*");
          to = "*";
        }
        if (link) {
          // If we found a link, generate a fake path.
          link = link.clone();
          link.node = to;
          path = [link];
        }
      }

      debug("shortest path from " + this.animDestState + " to " + this.instantaneousState + ": " + JSON.stringify(path));

      if (path && path.length > 0) {
        // We have a valid animation to schedule.
        var nextSegment = path[0];
        var nextState = nextSegment.node;
        var keyframeDest = nextState;

        if (nextState == "*") {
          // If our animation segment is a to-generic path, then we are animating to the current instantaneous state,
          // but the name of the keyframe set to use is STAR, not the destination state.
          nextState = this.instantaneousState;
          keyframeDest = "STAR";
        }

        // Generate keyframe set
        var animStyle = document.querySelector("#animStyle");
        if (!animStyle) {
          animStyle = document.createElement("style");
          animStyle.id = "animStyle";
          document.querySelector("head").appendChild(animStyle);
        }
        var fromName = fromStar ? "STAR" : this.animDestState;
        var keyFrameName = this.property + "_" + fromName + "-" + keyframeDest;

        var fromStyle = this.fromStyle;
        
        if (nextState == this.instantaneousState) {
          // If animating to a real state we can just use the current style.
          var toStyle = this.getStyleFromObject();
        } else {
          // If animating to an intermediate state we need to generate an explicit style for that state.
          var toStyle = expandToLonghand(this.animations.generateExplicitStyle(this.property, nextState));
        }

        if (nextSegment.isKeyframe()) {
          // Keyframe case.
          var keyFrame = keyframes[nextSegment.keyframe];
          if (!keyFrame) {
            this.failAnimation();
            return;
          }
            animStyle.innerHTML = this.generateKeyframe(fromStyle, toStyle, keyFrameName, keyFrame);
        }
        else if (fromStyle && toStyle) {
          // Direct interpolation case.
          animStyle.innerHTML = 
            "".concat(
              "@-webkit-keyframes ", keyFrameName, " {\n",
              " from {\n",
                 this.generateEndPoint(fromStyle, nextSegment.properties),
              " }\n",
              " to {\n",
                 this.generateEndPoint(toStyle, nextSegment.properties),
              "  }\n",
              "}\n");
        } else {
          this.failAnimation();
          return;
        }

        // setting property_anim triggers a CSS Rule to apply the newly generated keyframe.
        this.element.setAttribute(this.property + "_anim", keyFrameName);
        this.animDestState = nextState;
        this.animInProgress = true;
        this.fromStyle = toStyle;
        return;
      }
      this.failAnimation();
    }
  }

  // Resets this animation to a consistent state after a failed attempt to
  // schedule an animation.
  this.failAnimation = function() {
    this.animInProgress = false;
    this.animDestState = this.instantaneousState;
    this.fromStyle = undefined;
    this.setStyleFromObject();
  }
}

//
// Element
//
// A collection of the data needed to track an element, including all animations
// that apply to that element.
function Element(element) {

  // Tracked animations, keyed by the property used to track animation state.
  this.animations = {}

  // Element these animations apply to.
  this.element = element;

  // Adds a new animation that uses the provided property to track state.
  this.addAnimation = function(property) {
    var animation = new Animation(this, this.element, property);
    this.animations[property] = animation;
    return animation;
  }

  // Returns the animation that tracks state using the provided property,
  // creating one if necessary.
  this.lookupAnimation = function(property) {
    var result = this.animations[property];
    if (!result) {
      result = this.addAnimation(property);
    }
    return result;
  }

  // Returns a list of animations that use one of the properties in the
  // provided changedProperties list to track state.
  this.lookupAnimationsByChanges = function(changedProperties) {
    var results = [];
    for (var property in this.animations) {
      if (changedProperties.indexOf(property) >= 0) {
        results.push(this.animations[property]);
      }
    }
    return results;
  }

  // Generates a style dictionary that takes into account all style information
  // in @node sections for this element. If property and value are provided
  // then the current known state of propertty is overridden by the provided
  // value for the purposes of style generation.
  this.generateExplicitStyle = function(property, value) {
    var animationStates = this.animationStates();
    if (property && value) {
      animationStates[property] = value;
    }
    // @node data is stored in the animationSelectors data structure, so we need to 
    // ask it what our explicit style will be, given these animation states.
    var style = animationSelectors.explicitStyleForObject(this.element, animationStates);

    // Only return a style object if there is some explicit style information.
    var props = false;
    for (var prop in style) {
      props = true;
      break;
    }
    if (props) {
      return style;
    }
  }

  // Updates a style rule that takes into account all style information
  // in @node sections for this element.
  this.updateExplicitStyles = function() {
    // Generate the explicit style dictionary.
    var style = this.generateExplicitStyle();

    // Extract the style sheet that stores this element's explicit style.
    var id = "animStyle" + "_" + this.element.id;
    var animStyle = document.querySelector('#' + id);

    if (style) {
      // Construct a style sheet if none exists.
      if (!animStyle) {
        animStyle = document.createElement("style");
        animStyle.id = id;
        document.querySelector("head").appendChild(animStyle);
      }

      // Populate style rule.
      animStyle.innerHTML =  "#".concat(this.element.id, " {\n")
      for (var prop in style) {
        animStyle.innerHTML += "  ".concat(prop, ": ", style[prop], ";\n");
      }
      animStyle.innerHTML += "}\n"
    } else if (animStyle) {
      // No style exists but an old style rule might - clear the sheet out to ensure the rule
      // is gone.
      animStyle.innerHTML = "";
    }
  }

  // Returns the current state of all properties that animations are keyed from for
  // this element.
  this.animationStates = function() {
    var states = {}
    for (var property in this.animations) {
      states[property] = this.animations[property].instantaneousState;
    }
    return states;
  }

  // Calls the provided function on each animation registered against
  // this element.
  this.forEach = function(f) {
    for (var property in this.animations) {
      f(this.animations[property]);
    }
  }
}

//
// Elements
//
// The collection of DOM elements that are tracked, along with the animations
// that apply to them.
function Elements() {
  this.elements = {}

  // Adds a new element to be tracked.
  this.addElement = function(element) {
    var elementRef = new Element(element);
    this.elements[element.id] = elementRef;
    return elementRef;
  }

  // Looks up an animation given an element and a property that the animation
  // is keyed by. If the provided element and property are not yet tracked,
  // then calling this method causes them to be tracked.
  this.lookupAnimation = function(element, property) {
    var elementRef = this.elements[element.id];
    if (!elementRef) {
      elementRef = this.addElement(element);
    }
    return elementRef.lookupAnimation(property);
  }

  // Looks up a set of animations that might be impacted by the provided
  // changed properties for the provided element.
  this.lookupAnimationsByChanges = function(element, changedProperties) {
    var elementRef = this.elements[element.id];
    if (!elementRef) {
      return [];
    }
    return elementRef.lookupAnimationsByChanges(changedProperties);
  }

  // Returns the tracking data for the provided element if it exists.
  this.lookupElement = function(element) {
    var elementRef = this.elements[element.id];
    if (!elementRef) { return undefined; }
    return elementRef;
  }
}

//
// AnimationInfo
//
// AnimationInfo tracks information associated with a single selector string
// and tracked property. The property is not stored in the AnimationInfo object
// as it is not required. See AnimationSelector comments for more information.
//
// Two different kinds of information are tracked:
// (1) any information about edges (transitions from one state to another)
// (2) any information about nodes (the rendered appearance of a given state)
function AnimationInfo(selector) {
  this.selector = selector;

  // Edge information is stored in graph.
  this.graph = new Graph();

  // Node information is stored in this styles dictionary.
  this.styles = {}

  // Adds an edge to the graph representation for this selector.
  this.addEdge = function(from, to, cost, properties, keyframe) {
    this.graph.addEdge(from, to, new EdgeData(cost, this.selector, properties, keyframe));
  }

  // Adds a style to the styles dictionary for this selector.
  this.addStyle = function(name, properties) {
    this.styles[name] = properties;
  }
}

//
// AnimationSelector
//
// An AnimationSelector object stores information for all tracked properties
// associated with a single selector string. For example, the following
// two definitions:
//
// @transition-graph mySelector {
//   over: myProperty;
//   ...
// }
// @transition-graph mySelector {
//   over: myOtherProperty;
//   ...
// }
//
// will share an AnimationSelector object but have distinct AnimationInfo
// objects.
function AnimationSelector(selector, reference) {
  this.selector = selector;
  this.animations = {};
  this.reference = reference;

  // Adds a new AnimationInfo object for the provided tracked property.
  this.addAnimation = function(property) {
    var animation = new AnimationInfo(this.selector);
    this.animations[property] = animation;
    this.reference.properties.push(property)
    return animation;
  }

  // Returns the AnimationInfo object associated with the provided tracked
  // property.
  this.lookupInfo = function(property) {
    return this.animations[property];
  }
}

//
// Selectors
//
// This singleton object stores all information about @transition-graph
// declarations, organised by declared selector and over: property.
function Selectors() {
  // The AnimationSelector objects used to track @transition-graph information.
  this.selectors = {};

  // A representation of stored selectors used for emulating specificity, including a list
  // of properties that track animations for which each selector is important.
  this.selectorList = [];

  // When defined, the stored selectors sorted by specificity.
  this.sortedSelectors = undefined;

  // An index used to track relative text order of selectors.
  this.textIndex = 0;

  // Calculates the specificity of the provided selector.
  this.specificityOf = function (selector) {
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

  // Adds a new selector to be tracked.
  this.addSelector = function(selector) {
    var reference = {specificity: this.specificityOf(selector), textIndex: this.textIndex, selector: selector, properties: []};
    this.selectorList.push(reference)
    this.sortedSelectors = undefined;
    this.textIndex += 1;
    var animSelector = new AnimationSelector(selector, reference);
    this.selectors[selector] = animSelector;
    return animSelector;
  }

  // Looks up information associated with the provided selector
  // and property, creating the objects if necessary. Property
  // may be elided, in which case the AnimationSelector corresponding
  // to the provided selector is returned.
  this.lookupInfo = function(selector, property) {
    var animSelector = this.selectors[selector];
    if (!animSelector) {
      animSelector = this.addSelector(selector);
    }
    if (property) {
      var result = animSelector.lookupInfo(property);
      if (!result) {
        result = animSelector.addAnimation(property);
      }
      return result;
    }
    return animSelector;
  }

  // Sorts the selectors in the selector list.
  this.sortSelectors = function() {
    this.sortedSelectors = this.selectorList.sort(function(a, b) {
      if (a.specificity > b.specificity) {
        return 1;
      } else if (a.specificity < b.specificity) {
        return -1;
      } else {
        if (a.textIndex > b.textIndex) {
          return 1;
        } else if (a.textIndex < b.textIndex) {
          return -1;
        }
        return 0;
      }
    });
  }

  // Returns the selector list, sorted by specificty. Sorts list
  // if necessary.
  this.getSortedSelectors = function() {
    if (!this.sortedSelectors) {
      this.sortSelectors();
    }
    return this.sortedSelectors;
  }

  // Generates the explicit style for the provided element given the provided 
  // property:value current state. Retrieves style information stored in @node
  // declarations, sorted by relevant selector specificity.
  this.explicitStyleForObject = function(element, properties) {
    var selectors = this.getSortedSelectors();
    var result = {}
    for (var i = 0; i < selectors.length; i++) {
      var selector = selectors[i].selector;
      if (!element.webkitMatchesSelector(selector)) {
        continue;
      }
      for (var j = 0; j < selectors[i].properties.length; j++) {
        var property = selectors[i].properties[j];
        var state = properties[property];
        if (state) {
          var animInfo = this.lookupInfo(selector, property)
          // var animInfo = this.selectors[selector].animations[property];
          var style = animInfo.styles[state];
          if (style) {
            for (var prop in style) {
              result[prop] = style[prop];
            }
          }
        }
      }
    }
    return result;
  }

  // Generates the animations graph for the provided element and property.
  // Returns the graph information stored in @edge declarations, sorted
  // by relevant selector specificity.
  this.graphForObject = function(element, property) {
    var sortedSelectors = this.getSortedSelectors();
    var graph = new Graph();
    for (var i = 0; i < sortedSelectors.length; i++) {
      if (sortedSelectors[i].properties.indexOf(property) < 0) {
        continue;
      }
      var selector = sortedSelectors[i].selector;
      if (!element.webkitMatchesSelector(selector)) {
        continue;
      }
      var data = this.lookupInfo(selector, property);
      data.graph.overEdges(graph.addEdge.bind(graph));
    }
    return graph;
  }
}

//
// EdgeData
//
// POD Object repesenting an edge between two nodes in an animation graph.
function EdgeData(cost, selector, properties, keyframe) {
  // Cost of traversing this edge.
  this.cost = cost;
  // Selector for which this edge applies.
  this.selector = selector;
  // Properties that are animated while traversing this edge (undefined if
  // keyframe is defined).
  this.properties = properties;
  // Keyframe set that is to be used while traversing thie edge (undefined
  // if properties is defined).
  this.keyframe = keyframe;

  // Returns true if a keyframe set is defined for this edge.
  this.isKeyframe = function() { return keyframe != undefined; }

  // Returns a shallow copy of this data object.
  this.clone = function() { return new EdgeData(this.cost, this.selector, this.properties, this.keyframe); }
}

// 
// Graph
//
// An animation graph, storing animation edges. The nodes in this
// representation are implicitly defined by their presence in the
// edge dictionary. Generic paths are stored in this graph alongside
// explicit paths - generic "from" or "to" nodes are given the name
// of "*".
function Graph() {
  // Dictionary mapping source node name to destination dictionaries.
  // Each value in this dictionary maps destination node name to
  // edge data.
  this.fromNodes = {}

  // Adds the provided edgeData as an edge from the provided "from"
  // node name to the provided "to" node name.
  this.addEdge = function(from, to, edgeData) {
    if (!this.fromNodes[from]) {
      this.fromNodes[from] = {};
    }
    this.fromNodes[from][to] = edgeData;
  }

  // Iterates the provided function over all edges in the graph.
  this.overEdges = function(f) {
    for (var from in this.fromNodes) {
      for (var to in this.fromNodes[from]) {
        f(from, to, this.fromNodes[from][to]);
      }
    }
  }

  // Returns the edgeData associated with the edge from the provided "from"
  // node to the provided "to" node, or undefined if no such edge exists.
  this.lookupEdge = function(from, to) {
    if (this.fromNodes[from]) {
      return this.fromNodes[from][to];
    }
    return undefined;
  }

  // Calculates the shortest path between the provided "from" and "to" 
  // nodes, using Dijkstra's algorithm for shortest paths and ignoring
  // generic paths.
  this.shortestPath = function(from, to) {
    var nodes = {};
  
    for (var node in this.fromNodes) {
      // Ignore from-generic paths.
      if (node != "*") {
        nodes[node] = {visited: false, distance: undefined, path: []};
      }
    }

    // Early return if there's no edges from the provided "from" node.
    var current = from;
    if (!(current in nodes)) {
      return [];
    }

    nodes[current].distance = 0;
    while (true) {
      if (current == to) {
        // This is now the closest unvisited node, so the stored path
        // must be the correct one.
        return nodes[current].path
      }
      nodes[current].visited = true;
      var neighbours = this.fromNodes[current] || {};
      // Collect information about neighbours of the current node, but only 
      // if they are unvisited or we've found a cheaper path than the currently
      // stored path.
      for (var neighbour in neighbours) {
        // Ignore to-generic paths.
        if (neighbour == "*") {
          continue;
        }
        var edgeData = neighbours[neighbour];
        if (!(neighbour in nodes)) {
          nodes[neighbour] = {visited: false, distance: undefined, path: []};
        }
        var nrec = nodes[neighbour];

        var distance = edgeData.cost + nodes[current].distance;
        if (!(nrec.distance < distance)) {
          nrec.distance = distance;
          var newData = edgeData.clone();
          newData.node = neighbour;
          nrec.path = nodes[current].path.concat([newData]);
        }
      }
      // Update the current node to the unvisited node closest to the "from" node.
      var min = Infinity;
      var minNode = undefined;
      for (var node in nodes) {
        if (nodes[node].visited == false && (nodes[node].distance != undefined) && nodes[node].distance < min) {
          minNode = node;
          min = nodes[node].distance;
        }
      }
      if (minNode == undefined) {
        return undefined;
      }
      current = minNode;
    }
  }
}

////////////////////////////////////////////////////////////////////////////////
// Data
////////////////////////////////////////////////////////////////////////////////

// Singleton storing all tracked element data.
var elements = new Elements();

// Singleton storing all CSS animation data.
var animationSelectors = new Selectors(); 

////////////////////////////////////////////////////////////////////////////////
// Events and Registration
////////////////////////////////////////////////////////////////////////////////

// When a style rule is modified, this handler ensures that current object state is correct.
function updateStyleOnStyleRuleChange(event) {
  [].forEach.call(document.querySelectorAll(event.target.selectorText), function(element) {
    var animations = elements.lookupElement(element);
    if (!animations) {
      return;
    }
    animations.forEach(function(animation) {
      debug("forcing style update for " + animation.element.id + 
                  " animating property: " + animation.property + 
                  " state: " + animation.instantaneousState);
      animation.setStyleFromObject();
    });
  });
}

// Recovers element and property information from global animationEnded event
// and redirects animationEnded call to the appropriate animation object.
function animationEnded(event) {
  debug("animation ended");
  var element = event.target
  var property = event.animationName.split("_")[0];
  var animation = elements.lookupAnimation(element, property);
  animation.animationEnded();
}

// Responds to changes in animation properties by changing state on the appropriate
// animation elements.
function stateChanged(event) {
  
  debug(function() {
    var s = "state changed for";
    for (var i = 0; i < event.changedProperties.length; i++) {
      s += " " + event.changedProperties[i] + ":" + event.oldStyle[event.changedProperties[i]] + "->" + event.newStyle[event.changedProperties[i]]
    }
    s += " for object " + event.target.id;
    return s;
  });

  var animations = elements.lookupAnimationsByChanges(event.target, event.changedProperties);
  debug("this impacts " + animations.length + " animations");
  for (var i = 0; i < animations.length; i++) {
    animations[i].setCurrentState(event.newStyle[animations[i].property]);
  }
}

document.documentElement.addEventListener("webkitAnimationEnd", animationEnded, false)
window.addStyleRuleChangedHandler(updateStyleOnStyleRuleChange);

////////////////////////////////////////////////////////////////////////////////
// Utils
////////////////////////////////////////////////////////////////////////////////

// Data to help expand CSS shorthand definitions to longhand.
// TODO: complete this.
// TODO: split out into a separate library.
var locs = ["bottom", "left", "right", "top"];
var corners = ["bottom-left", "bottom-right", "top-left", "top-right"];
var backgroundSubs = ["color", "style", "width"];

var borderStyles = ["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"];
var longhandStyles = ["width", "height", "left", "top", "color", "background-color", "-webkit-transform"]

for (var i = 0; i < locs.length; i++) {
  for (var j = 0; j < backgroundSubs.length; j++) {
    longhandStyles.push("border-" + locs[i] + "-" + backgroundSubs[j]);
  }
}
for (var i = 0; i < corners.length; i++) {
  longhandStyles.push("border-" + corners[i] + "-radius");
}

// Expands the provided style dictionary to longhand form.
function expandToLonghand(style) {
  var outStyle = {}
  for(var prop in style) {
    if (prop == "background") {
      outStyle["background-color"] = style[prop];
    } else if (prop == "border") {
      var bits = style[prop].split(" ")
      var borderStyle;
      var borderWidth;
      var borderColor;
      for (bit in bits) {
        if (borderStyles.indexOf(bit) != -1) {
          borderStyle = bit;
        } else if (Number(a[0]) != Nan) {
          borderWidth = bit;
        } else {
          borderColor = bit;
        }
      }
      for (var j = 0; j < locs.length; j++) {
        if (borderColor) {
          outStyle["border-" + locs[j] + "-color"] = borderColor;
        }
        if (borderStyle) {
          outStyle["border-" + locs[j] + "-style"] = borderStyle;
        }
        if (borderWidth) {
          outStyle["border-" + locs[j] + "-width"] = borderWidth;
        }
      }
    } else if (prop == "-webkit-border-radius") {
      for (var j = 0; j < corners.length; j++) {
        outStyle["border-" + corners[j] + "-radius"] = style[prop];
      }
    } else {
      outStyle[prop] = style[prop];
    }
  }
  return outStyle;
}

// Converts the provided list of properties from mixed shorthand and longhand properties to
// a list of longhand properties.
function longhandFor(properties) {
  if (!properties) {
    return undefined;
  }
  var outPropList = []
  for (var i = 0; i < properties.length; i++) {
    if (properties[i] == "background") {
      outPropList.push("background-color");
    } else if (properties[i] == "border") {
      for (var j = 0; j < locs.length; j++) {
        for (var k = 0; k < backgroundSubs.length; k++) {
          outPropList.push("border-" + locs[j] + "-" + backgroundSubs[k]);
        }
      }
    } else if (properties[i] == "-webkit-border-radius") {
      for (var j = 0; j < corners.length; j++) {
        outPropList.push("border-" + corners[j] + "-radius");
      }
    } else {
      outPropList.push(properties[i]);
    }
  }
  return outPropList;
}

////////////////////////////////////////////////////////////////////////////////
// Globals
////////////////////////////////////////////////////////////////////////////////


// Registers the provided property as one that animates for the provided selector.
function registerAnimatedProperty(selector, property) {
  window.addComputedStyleChangedHandler(stateChanged, [property], selector);

  var animInfo = animationSelectors.lookupInfo(selector, property);
  var matchedElements = document.querySelectorAll(selector);
  debug(function() {
    var forObjs = " - no objects affected";
    if (elements.length > 0) {
      forObjs = " and setting state for " + [].map.call(matchedElements, function(a) { return a.id });
    }
    return "adding animation selector " + selector + forObjs;
  });    

  // Set the current state of all matching elements to the current value of the
  // provided property.
  [].forEach.call(matchedElements, function(element) {
    var style = CSSEmu.currentStyle(element);
    elements.lookupAnimation(element, property).setCurrentState(style[property]);
  });
}

// Registers an edge with the provided "from" and "to" nodes, cost, properties or keyframe 
// with the animation identified by the provided selector and property. If keyframe is defined,
// then this edge is a keyframe edge, otherwise a plain transition is used over the provided
// properties. If 'reverse' is true, then the added edge is added from the 'to' node to the 'from'
// node and (if provided) the keyframe set is reversed.
// TODO: implement keyframe reversal.
function registerAnimationEdge(selector, property, from, to, cost, properties, keyframe, reverse) {
  if (reverse && keyframe) {
    throw "Reversal of explicit keyframes unimplemented";
  }
  if (reverse) {
    animationSelectors.lookupInfo(selector, property).addEdge(to, from, cost, longhandFor(properties), keyframe);
  } else {
    animationSelectors.lookupInfo(selector, property).addEdge(from, to, cost, longhandFor(properties), keyframe);
  }
}

var keyframes = {}

// Adds the provided keyframe set to the dictionary of known animation keyframe sets.
// The format for the keyframeSpec is:
// {
//   ident: keyframe name (as referred to by @nedge declarations)
//   blocks: [{
//     selectors: ["from", "to", or CSS percentage values as strings]
//     rules: ["property:value", value can include from(), to(), prev()]
//   }]
// }
function addKeyframes(keyframesSpec) {
  keyframes[keyframesSpec.ident] = keyframesSpec;
}

// Registers an explicit style added by an @node declaration with the animations
// identified by the provided selector and property. The style is active when the
// provided property's value is the provided value, and applies the additional
// values in the provided properties map.
function registerExplicitStyle(selector, property, value, properties) {
  animationSelectors.lookupInfo(selector, property).addStyle(value, properties);
  [].forEach.call(document.querySelectorAll(selector), function(element) {
    elements.lookupElement(element).updateExplicitStyles(); 
  });
}

if (!window.ExcssAnimation) {
  window.ExcssAnimation = {
    addAnimNameForSelector: registerAnimatedProperty,
    addTransitionForSelector: registerAnimationEdge,
    addKeyframes: addKeyframes,
    addPropertiesForSelector: registerExplicitStyle
  }
}

}(window));



# Overview #

This library fulfills three purposes:
  * It provides CSS events - javascript callbacks which trigger on changes to CSS state.
  * It supports filtering of CSS events based on matching selector and property expressions
  * It supports an additional “phantom" class of CSS properties - additional CSS content which does not modify the rendered style of an object but which appears in the apparent style hierarchy when objects are inspected using the emulation library.

Additionally, it is a goal of this library to integrate well with excss - for example, by allowing excss to parse phantom properties and populate style rules with them correctly.

Finally, this library aims to explore the usefulness of CSS Events in order to determine whether it is worth attempting to specify them as a part of the web platform.

# Use Cases #

Here are some thoughts as to potential uses of the library.

## State-based CSS Transitions ##

By using CSS events to watch for changes in CSS state, and phantom properties to model abstract application state, it’s possible to significantly enhance the current CSS Transitions and Animations specification in the following ways:
  * using state machines to define and track transitions between states
  * providing alternative semantics to cancel-and-restart for transitions that are interrupted
  * allowing complex keyframe-based edge transition definitions

An example of these ideas in action is included in this library, and can be viewed online [here](http://css-events.googlecode.com/git/examples/animation/index.html).

In general, any application that needs to track changes in computed style would benefit from CSS Events.

## CSS Mixins ##

CSS events also provide a mechanism for exploring and using extensions to the CSS specification.  For example, a feature analogous to mixins can be implemented using CSS events and data- properties. A simplified version is shown below. Note that this particular implementation is not completely transparent to the application developer - in particular, inline styles are not conserved when this implementation is used.  However, even in the current simplified state, this approach is useful in many circumstances, and it is clear that there are no essential barriers to implementing fully transparent mixins.

```
<script>
mixins = {“bar”: “background-color: red; color: green; border: 2px solid black;”}

function applyMixin(event) {
	var mixin = event.newStyle[“data-mixin”];
	if (mixin) {
		event.target.setAttribute(“style”, mixins[mixin]);
	} else {
		event.target.setAttribute(“style”, null);
	}
}

window.addComputedStyleChangedHandler(applyMixin, [‘data-mixin’]);
</script>
<style>
  .foo {
    data-mixin: bar;
  }
</style>
<body>
  <div class=’foo’>Some text</div>
</body>
```

## Improving the CSSOM ##

In general, CSS Events are analogous to DOM Mutation Events, and use cases fall along similar lines.  As the CSSOM becomes more widely used, there will be a need for libraries to react to CSS changes, much as libraries like jQuery are currently interested in reacting to DOM changes. For example, there are jQuery proposals to use DOM Mutations as a way to make widgets more declarative.  CSS Events would extend this approach still further by allowing jQuery widgets to be declared in CSS rather than in attributes on the DOM.

# CSS Events #

## Event Types ##

Four event types are proposed:

### MatchedCSSRulesChanged Events ###

Users can register a handler for MatchedCSSRulesChanged events by setting the `onMatchedCSSRulesChanged` property of DOM elements. The provided handler will be called with a MatchedCSSRulesChanged whenever the set or order of matching CSSRules changes for the element. These events bubble through the DOM hierarchy.

MatchedCSSRulesChanged events contain the following fields:
  * `target`: the element for which the style hierarchy has changed
  * `oldStyle`: the old list of CSSRules that apply to the target element (from least specific to most specific)
  * `newStyle`: the new list of CSSRules that apply to the target element (from least specific to most specific)


MatchedCSSRulesChanged events can also be intercepted by registering a handler using:

```
window.addMatchedCSSRulesChangedHandler(handler, selector);
```

In this case, the provided handler will be called whenever the matched CSSRules stack changes for an element selected by the provided selector.  Note that selector may be undefined or null, in which case a universal selector (`*`) will be used.

**Implementation note 1:** The generation of these events can be optimized in WebKit by using the getMatchedCSSRules method, which returns an ordered list of the rules that currently match an element. However, the previously matching CSS Rules must be stored against each element in order to generate the event correctly.

**Implementation note 2:** The interaction of phantom properties with these events requires that phantom properties be stored against the style rules they populate, so that the additional phantom properties can be included in the returned CSSRules. Furthermore, CSSRules that only contain phantom properties need to be checked for matches and inserted in specificity order, so the specificity of all selectors must be calculated and maintained.

### ComputedStyleChanged Events ###

Users can register a handler for ComputedStyleChanged events by setting the `onComputedStyleChanged` property of DOM elements. The provided handler will be called with a ComputedStyleChanged Event whenever the final computed value of one or more properties changes for an object. These events bubble through the DOM hierarchy.

ComputedStyleChanged events contain the following fields:
  * `target`: the element for which the computed style has changed
  * `oldStyle`: the old computed style for the element
  * `newStyle`: the new computed style for the element
  * `changedProperties`: the set of properties with new values

ComputedStyleChanged events can also be intercepted by registering a handler using:

```
window.addComputedStyleChangedHandler(handler, propertySet, selector);
```

In this case, the provided handler will be called whenever a property in the provided propertySet changes computed value for an element selected by the provided selector.  The propertySet is a list of values and may contain partially specified values using “`*`” as a pattern matching primitive (e.g. `*-color`, `border-*`, `margin-*`). Note that propertySet and selector may be null, in which case a universal selector (`*`) and/or universal propertySet (`[“*”]`) will be used.

### StyleRuleChanged Events ###

Users can register a handler for StyleRuleChanged events by setting the `onStyleRuleChanged` property of CSSStyleRule CSSOM objects. The provided handler will be called with a StyleRuleChanged event whenever the CSSStyleRule’s rules or selector changes.

StyleRuleChanged events can also be intercepted by registering a handler using:

```
window.addStyleRuleChangedHandler(handler, propertySet, selector);
```

In this case, the provided handler will be called whenever a property in the provided propertySet changes for any StyleRule with a selector value of the provided selector. The propertySet is a list of values and may contain partially specified values using “`*`”. Note that propertySet maybe be undefined, in which case a universal propertySet(`["*"]`) will be used. The provided selector may also be undefined, in which case the handler is provided with events generated by changes to every style rule on the page.

StyleRuleChanged events contain the following fields:
  * `target`: the CSSStyleRule for which the rules and/or selector have changed.
  * `oldStyle`: the CSSStyleRule before the change
  * `newStyle`: the CSSStyleRule after the change
  * `changedProperties`: the set of properties with changed values

### SelectedSetChanged Events ###

Users can register a handler for SelectedSetChanged events by setting the `onSelectedSetChanged` property of CSSStyleRule CSSOM objects. The provided handler will be called with a SelectedSetChanged event whenever the set of objects selected by the CSSStyleRule’s selector changes.

SelectedSetChanged events contain the following fields:
  * `target`: the CSSStyleRule for which the set of selected elements have changed
  * `newElements`: the set of elements which are newly selected by the rule
  * `removedElements`: the set of elements which are newly unselected by the rule
  * `unchangedElements`: the set of elements which were and are still selected by the rule

## Event Delivery Semantics ##

None of the proposed CSS Events are cancelable. MatchedCSSRulesChanged events and ComputedStyleChanged events are registered on DOM elements, and therefore bubble. On the other hand, StyleRuleChanged events and SelectedSetChanged events are registered on CSSOM objects. While bubbling would be possible in these instances (e.g. from styles to style sheets) it’s not yet clear whether it is useful or desirable.

# Phantom Properties #

Users can set phantom properties on a CSSStyleDeclaration. These properties do not inherit by default and are subject to the standard CSS specificity rules, and become part of the calculated computedStyle as well as exposed via the events listed above.
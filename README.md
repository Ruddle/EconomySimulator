# EconomySimulator

Code of the simulator, and its display, from the blog post [Building an economy simulator from scratch](https://thomassimon.dev/ps/4).
It uses mithril.js.

# How to use

Example of usage:
Simulation 25 from the blog post

```js
import m from "mithril";
import * as economy from "./economy.js";

economy.init(m);

let options = {
  money: true,
  overconsume: true,
  bidding: true,
  sellMin: true,
  qol2: true,
  highNumbers: true,
  truncate: true,
  resourcesCons: ["food", "water", "wood"],
  peopleOpt: [
    { producer: "food", money: 1000 },
    { producer: "food", money: 1000 },
    { producer: "food", money: 1000 },
    { producer: "wood", money: 1000 },
    { producer: "water", money: 1000 },
    { producer: "gov", money: 1000 },
    { producer: "gov", money: 1000 },
    { producer: "gov", money: 1000 },
  ],
  prices: { food: 100, wood: 100, water: 100 },
  gov: {
    resources: { money: 1000 },
    tax: 3,
    autoTax: false,
    print: true,
    fluid: { mul: 1.5 },
  },
};

m.mount(document.body, { view: () => m(economy.Root, options) });
```

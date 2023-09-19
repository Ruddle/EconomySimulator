let m;
/** The ui is built with mithril.js
 *
 * This module supposes that it is already loaded.
 *
 * You have to initialize this module with it as a parameter
 */
export function init(m_) {
  m = m_;
}

const W = 520;
const mobile = window.innerWidth < 520;

const EMOJIS = {
  wood: "🪵",
  water: "💧",
  food: "🍎",
  gov: "🏛️",
  money: "💰",
  rocket: "🚀",
  dead: "💀",
  farmer: "🧑‍🌾",
  public: "🧑‍💼",
  ghost: "👻",
  time: "⌛",
};

const event = new EventTarget();
const PAUSE_EVENT = "0";

function pauseAll() {
  event.dispatchEvent(new CustomEvent(PAUSE_EVENT));
}

/** State machine node type*/
const TYPE = {
  INIT: 0,
  TICK_PROD_CONS: 2,
  GOV_PAY: 3,
  GOV_PRINT: 4,
  SELECT_SELLER: 7,
  SELECT_BUYER: 8,
  MAKE_DEAL: 9,
  ADJUST_PRICES: 10,
  END_OF_DAY: 11,
};

const TICK_FUNC = {};

TICK_FUNC[TYPE.INIT] = (s) => {
  s.type = TYPE.END_OF_DAY;
};

TICK_FUNC[TYPE.END_OF_DAY] = function endOfDay(s) {
  s.type = TYPE.TICK_PROD_CONS;

  let QoL = 0;
  let count = 0;
  s.people.forEach((p) => {
    if (!p.alive) return;
    let qol = s.qol2 ? personQoL2(p) : personQoL1(p);
    count += 1;
    QoL += qol;
    p.QoL = qol;
  });

  s.QoL = count > 0 ? QoL / count : 0;
  s.msg = null;
};

TICK_FUNC[TYPE.TICK_PROD_CONS] = function tickProdCons(s) {
  s.people.forEach((p) => {
    if (!p.alive) return;
    p.priority = 0;
    p.sold = 0;
    Object.keys(p.resources).forEach((res) => {
      if (res === "money") return;
      if (res == p.producer) {
        p.resources[res] += 10;
      } else {
        if (p.resources[res] < 6 || !s.overconsume) {
          p.resources[res] -= 1;
        } else {
          let a = p.resources[res] - 6;
          p.resources[res] -= 2 + Math.floor(a / 3);
        }

        if (p.resources[res] < 0) {
          p.alive = false;
        }
      }
    });
  });
  s.generation += 1;
  s.time += 1;
  if (s.gov) {
    s.type = TYPE.GOV_PAY;
  } else {
    if (s.money) {
      s.type = TYPE.SELECT_SELLER;
    } else {
      s.type = TYPE.END_OF_DAY;
    }
  }
};

TICK_FUNC[TYPE.GOV_PAY] = function govPay(s) {
  let govworkerIds = s.people
    .filter((e) => e.producer == "gov" && e.alive)
    .map((e) => e.id);
  govworkerIds.sort((a, b) => Math.random() - 0.5);

  let maxMoneyPerWorker = Math.floor(
    s.gov.resources.money / govworkerIds.length
  );
  for (let a = 0; a < govworkerIds.length; a++) {
    let idA = govworkerIds[a];
    let personA = s.people[idA];
    if (!personA.alive || personA.producer != "gov") continue;

    let targetMoney = 150;
    let missing = targetMoney - personA.resources.money;

    if (s.gov.fluid) {
      missing = 0;
      s.resourcesCons.forEach((e) => {
        missing += s.prices[e] * (s.gov.fluid?.mul || 4);
      });
      missing = Math.ceil(missing);
    }

    missing = Math.min(maxMoneyPerWorker, missing);

    if (missing > 0 && s.gov.resources.money >= missing) {
      s.gov.resources.money -= missing;
      personA.resources.money += missing;
    }
  }

  if (s.gov.autoTax) {
    s.gov.autoTaxAmount = autoTaxAmount(s);
  }

  if (s.gov.print) {
    s.type = TYPE.GOV_PRINT;
  } else {
    s.type = TYPE.SELECT_SELLER;
  }
};

TICK_FUNC[TYPE.GOV_PRINT] = function govPrint(s) {
  let targetMoney = 1000;
  if (s.gov.fluid) {
    targetMoney = 0;
    s.resourcesCons.forEach((e) => {
      targetMoney += s.prices[e];
    });
    targetMoney *= 33;
  }
  let toPrint = Math.max(0, targetMoney - s.gov.resources.money);
  s.msg = { print: toPrint };
  s.gov.resources.money += toPrint;
  if (s.truncate) {
    let sum = 0;
    let count = 0;
    s.people.forEach((p) => {
      if (!p.alive) return;
      sum += p.resources.money;
      count += 1;
    });
    if (count > 0) {
      let avg = sum / count;
      if (avg > 100000) {
        s.gov.resources.money = Math.floor(s.gov.resources.money / 10);
        s.people.forEach((p) => {
          if (!p.alive) return;
          p.resources.money = Math.floor(p.resources.money / 10);
        });
        s.resourcesCons.forEach(
          (r) => (s.prices[r] = Math.floor(s.prices[r] / 10))
        );
      }
    }
  }
  s.type = TYPE.SELECT_SELLER;
};

TICK_FUNC[TYPE.SELECT_SELLER] = function selectSeller(s) {
  //Round robin the sellers every sales, to give everyone a chance
  let sortedId = s.people.map((e) => {
    return { id: e.id, priority: e.priority }; //stock: e.resources[e.producer]
  });

  sortedId.sort(
    (a, b) => (b.priority - a.priority) * 1000 + Math.random() - 0.5
  ); //b.stock - a.stock

  sortedId = sortedId.map((e) => e.id);

  for (let a = 0; a < s.people.length; a++) {
    let idA = sortedId[a];
    let personA = s.people[idA];
    if (!personA.alive) continue;

    let canSell =
      personA.producer != "gov" &&
      (s.overconsume
        ? resourceSellIsWorthIt(personA, personA.producer, s)
        : personA.resources[personA.producer] > 3);

    personA.wantsToSell = canSell;
    if (canSell && personA.generation !== s.generation) {
      personA.priority -= 1;
      s.msg = { seller: idA };
      s.type = TYPE.SELECT_BUYER;
      personA.generation = s.generation;

      return;
    }
  }

  s.type = s.bidding ? TYPE.ADJUST_PRICES : TYPE.END_OF_DAY;
};

TICK_FUNC[TYPE.SELECT_BUYER] = function selectBuyer(s) {
  let seller = s.people[s.msg.seller];
  let price = s.prices[seller.producer];
  {
    let sortedId = s.people.map((e) => {
      return {
        id: e.id,
        priority:
          Math.random() -
          (s.starvedPriority ? 1000 * e.resources[seller.producer] : 0),
      };
    });
    sortedId.sort((a, b) => b.priority - a.priority);
    sortedId = sortedId.map((e) => e.id);

    for (let a = 0; a < s.people.length; a++) {
      let id = sortedId[a];
      let person = s.people[id];
      if (!person.alive || person.id == seller.id) continue;

      if (!s.overconsume && person.resources[seller.producer] >= 3) continue;

      let worthIt =
        !s.overconsume || resourceBuyIsWorthIt(person, seller.producer, s);
      if (
        person.producer != seller.producer &&
        person.resources.money >= price &&
        worthIt
      ) {
        s.bid = price;
        s.msg.buyer = id;
        s.type = TYPE.MAKE_DEAL;
        return;
      }
    }
  }

  s.msg = null;
  s.type = TYPE.SELECT_SELLER;
};

TICK_FUNC[TYPE.MAKE_DEAL] = function makeDeal(s) {
  let seller = s.people[s.msg.seller];
  let buyer = s.people[s.msg.buyer];
  let res = seller.producer;

  seller.resources[res] -= 1;
  buyer.resources[res] += 1;

  seller.sold += 1;

  let bid = s.bid;

  buyer.resources.money -= bid;

  if (s.gov) {
    let tax = s.gov.tax;
    if (s.gov.autoTax) {
      tax = s.gov.autoTaxAmount;
    }

    let taxed = Math.floor((bid * (tax * 10)) / 100);
    seller.resources.money += bid - taxed;
    s.gov.resources.money += taxed;
  } else {
    seller.resources.money += bid;
  }

  s.generation += 1;
  s.msg.deal = true;
  s.type = TYPE.SELECT_SELLER;
};

TICK_FUNC[TYPE.ADJUST_PRICES] = function adjustPrices(s) {
  s.resourcesCons.forEach((r) => {
    let unsold = 0;

    s.people.forEach((person) => {
      if (!person.alive || person.producer !== r) return;
      if (!s.qol2) {
        if (!personIsBoundByResource(person, r)) {
          unsold += 1;
        }
      } else {
        if (person.wantsToSell) {
          unsold += 1;
        }
      }
    });

    if (unsold == 0) {
      s.prices[r] = Math.ceil(s.prices[r] * 1.05);
    } else {
      s.prices[r] = Math.floor(s.prices[r] * 0.95);

      if (s.sellMin) {
        let otherSum = 0;
        s.resourcesCons.forEach((r2) => {
          if (r2 == r) return;
          otherSum += s.prices[r2];
        });
        s.prices[r] = Math.max(s.prices[r], Math.ceil(otherSum / 10));
      }

      s.prices[r] = Math.max(s.highNumbers ? 10 : 1, s.prices[r]);
    }
  });
  s.type = TYPE.END_OF_DAY;
};

/** Return the least owned resource type of a person */
function boundResource(p) {
  let bound = null;
  let min = Infinity;
  Object.entries(p.resources).forEach(([r, v]) => {
    if (r == "money") return;
    if (v < min) {
      bound = r;
      min = v;
    }
  });
  return bound;
}
/** Return the least owned resource quantity of a person */
function personQoL1(p) {
  return p.resources[boundResource(p)];
}
/** Return the advanced QoL of a person */
function personQoL2(p) {
  let QoL = 0;
  Object.entries(p.resources).forEach(([r, v]) => {
    if (r == "money") return;
    QoL += Math.log(v);
  });
  return QoL;
}

function personIsBoundByResource(p, resource) {
  let foundLower = true;
  let min = p.resources[resource];
  Object.entries(p.resources).forEach(([r, v]) => {
    if (r == "money") return;

    if (v < min) {
      foundLower = false;
    }
  });
  return foundLower;
}

function resourceBuyIsWorthIt(p, resource, s) {
  if (!s.qol2) return personIsBoundByResource(p, resource);

  let price = s.prices[resource];
  let current = p.resources[resource];
  let qolIncrease = Math.log(current + 1) - Math.log(current);
  let ratioToBeat = qolIncrease / price;

  let ratioBeat = false;
  s.resourcesCons.forEach((r) => {
    if (r == resource || ratioBeat) return;
    let price = s.prices[r];
    let current = p.resources[r];
    let qolIncrease = Math.log(current + 1) - Math.log(current);
    let ratio = qolIncrease / price;
    if (ratio > ratioToBeat) {
      ratioBeat = true;
    }
  });
  return !ratioBeat;
}

function resourceSellIsWorthIt(p, resource, s) {
  if (!s.qol2) return !personIsBoundByResource(p, resource);

  let price = s.prices[resource];
  let current = p.resources[resource];

  if (current == 0) return false;

  let qolDec = Math.log(current - 1) - Math.log(current);
  let sucksAmount = qolDec / price;

  let ratioBeat = false;
  s.resourcesCons.forEach((r) => {
    if (r == resource || ratioBeat) return;
    let price = s.prices[r];
    let current = p.resources[r];
    let qolIncrease = Math.log(current + 1) - Math.log(current);
    let NiceAmount = qolIncrease / price;
    if (NiceAmount > -sucksAmount) {
      ratioBeat = true;
    }
  });
  return ratioBeat;
}

function genPerson(i, options) {
  let resources = {};

  if (options.money) {
    resources.money = 50;
    let mo = options.peopleOpt?.[i]?.money;
    if (mo != null) {
      resources.money = mo;
    }
  }

  options.resourcesCons.forEach((r) => {
    resources[r] = 3;
  });
  return {
    alive: true,
    id: i,
    resources,
    producer: options.peopleOpt?.[i]?.producer || options?.producer?.[i],
    priority: 0,
    generation: -1,
  };
}

function autoTaxAmount(s) {
  let m = s.gov.resources.money;
  let base = s.gov.tax;

  let dir = m < 900 ? 1 : -1;
  while (m < 900 || m > 1100) {
    m += dir * 100;
    base += dir;
  }
  return base;
}

const OPTIONS_DEFAULT = {
  gov: false,
  money: false,
  bidding: false,
  overconsume: false,
  starvedPriority: false,
  truncate: false,
  sellMin: false,
  qol2: false,
  resourcesCons: [],
  producer: [],
  people: [],
};

// UI code from here until EOF
export function Root({ attrs }) {
  let options = {
    ...OPTIONS_DEFAULT,
    ...attrs,
  };

  let state = {};
  let playing = false;
  let playingMs = 0;
  let stop = null;

  function rebuild(opt) {
    if (stop) stop();
    state = {};
    playing = false;
    playingMs = 0;
    stop = null;
    options = opt;
    reset();
  }
  function reset() {
    if (stop) stop();
    playing = false;

    stop = null;

    state = {
      //time increments when people produce and consume for 1 standard step
      time: 0,
      //generation is incremented when state is mutated
      generation: 0,
      // increment every tick
      step: 0,
      // msg: { buyer: 1, seller: 0, deal: true },
      type: TYPE.INIT,
      prices: {},

      QoL: 3,
    };

    options.peopleCount =
      options?.producer?.length || options?.peopleOpt?.length;
    state = { ...structuredClone(state), ...structuredClone(options) };

    state.resourcesCons = options.resourcesCons;
    state.resourcesCons.forEach((r) => {
      if (!state.prices[r]) state.prices[r] = 10;
    });

    state.people = [...new Array(options.peopleCount)].map((e, i) =>
      genPerson(i, options)
    );

    state.count = options.peopleCount + (options.gov ? 1 : 0);
    if (state.gov) state.gov.autoTaxAmount = autoTaxAmount(state);
    m.redraw();
  }
  reset();

  function simulateStep() {
    TICK_FUNC[state.type](state);
    state.step += 1;
  }

  function fast() {
    return playing && playingMs <= 1;
  }

  function pause() {
    if (stop) stop();
    playing = false;
    playingMs = 200;
  }

  event.addEventListener(PAUSE_EVENT, () => {
    try {
      pause();
    } catch {}
  });

  function play(ms) {
    playing = true;
    playingMs = ms;
    let quit = false;
    stop = () => {
      quit = true;
    };

    const startTime = performance.now();
    const startStep = state.step;

    let aux = () => {
      if (quit) return;

      let startAux = performance.now();
      let timeSincePlay = startAux - startTime;
      let targetStep = ms > 0 ? startStep + timeSincePlay / ms : Infinity;

      let missingStep = targetStep - state.step;

      let overtimed = false;

      const maxUncheckedStep = ms > 0 ? 3 : 20;
      while (missingStep >= 1 && !overtimed) {
        //Step 3 by 3 to avoid checking time too often
        for (let i = 0; i < Math.min(missingStep, maxUncheckedStep); i++) {
          simulateStep();
          missingStep -= 1;
        }
        overtimed = performance.now() - startAux > 8;
      }

      m.redraw();
      setTimeout(() => {
        aux();
      }, 0);
    };
    aux();
  }

  function playAt(ms) {
    pauseAll();
    play(ms);
  }

  return {
    view: () => [
      attrs.builder && m(SimBuilder, { apply: rebuild }),
      m(
        "div",
        {
          style: {
            borderTop: "15px solid #222",
            padding: "10px",
            borderRadius: "6px",
            background: "#000",
            paddingTop: "10px",
          },
        },

        //SIM INFO
        m(
          "div",
          {
            style: {
              marginTop: "0px",
              display: "flex",
              justifyContent: "space-between",
            },
          },
          m(TimeFrag, { val: state.time }),
          m(
            "div",
            { style: { marginLeft: "10px", color: "#888" } },
            "step " + state.step
          )
        ),

        m(
          "div",
          { style: { display: "flex" } },

          state.bidding &&
            m(
              "div",
              "Prices",
              options.resourcesCons.map((r) =>
                m("div", EMOJIS[r] + ": " + state.prices[r] + EMOJIS["money"])
              )
            ),
          state.overconsume &&
            m(
              "div",
              {
                style: {
                  marginLeft: "5px",
                  borderLeft: "1px solid #333",
                  paddingLeft: "5px",
                },
              },
              "Avg QoL: " + state.QoL.toFixed(1)
            )
        ),

        //SIM SQUARE
        m(
          "div",
          {
            style: {
              position: "relative",
              width: count2size(state.count).x + "px",
              height: count2size(state.count).y + 90 + "px",
              fontSize: mobile ? "0.8em" : "1em",
            },
          },
          state.gov && m(StateFrag, { state, fast: fast() }),
          state.people.map((person, i) =>
            m(PersonFrag, {
              i,
              state,
              fast: fast(),
            })
          ),
          state.msg?.deal && m(DealAnimFrag, { state, fast: fast() }),
          state.people.map(
            (person, i) =>
              state.type == TYPE.GOV_PAY &&
              person.alive &&
              m(GovPayFrag, {
                i,
                state,
                fast: fast(),
              })
          )
        ),
        //UI
        m(
          "div",
          { style: { display: "flex", justifyContent: "space-between" } },
          m(
            "button",
            { onclick: reset, style: { position: "relative" } },
            "Reset",
            state.time > 4 &&
              state.help &&
              m(
                "div",
                {
                  style: {
                    position: "absolute",
                    top: "-10px",
                    left: "25%",
                    transform: "translate(-0%, -100%)",
                    background: "#aaa",
                    textAlign: "left",
                    color: "black",
                    fontWeight: "bold",
                    // border: "1px solid white",
                    padding: "10px",
                    borderRadius: "25px 25px 25px 1px",
                    whiteSpace: "pre",
                  },
                },
                "Click here to reset"
              )
          ),
          m(
            "div",
            { style: { display: "flex" } },
            m(
              HoldButton,
              {
                onclick: () => {
                  pauseAll();
                  simulateStep();
                },
              },
              "step"
            ),
            m(
              HoldButton,
              { onclick: pauseAll, active: !playing },
              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "monospace",
                  },
                },
                m(IconPause)
              )
            ),
            m(
              HoldButton,
              {
                active: playing && playingMs == 200,
                onclick: () => playAt(200),
              },

              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "monospace",
                    fontSize: "0.8em",
                  },
                },
                m(IconPlay)
              ),
              state.type == TYPE.INIT &&
                state.help &&
                m(
                  "div",
                  {
                    oncreate: (e) => {
                      e.dom.animate(
                        [{ background: "#aaa" }, { background: "#ddd" }],
                        {
                          duration: 1000,
                          iterations: Infinity,
                          direction: "alternate",
                        }
                      );
                    },
                    style: {
                      position: "absolute",
                      top: "-10px",
                      left: "50%",
                      transform: "translate(-0%, -100%)",
                      background: "#aaa",
                      textAlign: "left",
                      color: "black",
                      fontWeight: "bold",
                      // border: "1px solid white",
                      padding: "10px",
                      borderRadius: "25px 25px 25px 1px",
                    },
                  },
                  "Click to start the simulation"
                )
            ),
            m(
              HoldButton,
              {
                active: playing && playingMs == 50,
                onclick: () => playAt(50),
              },
              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "monospace",
                    fontSize: "0.8em",
                  },
                },
                m(IconPlay),
                "x4"
              )
            ),
            m(
              HoldButton,
              {
                active: playing && playingMs == 1,
                onclick: (e) => {
                  if (!e.target.classList.contains("turbo")) {
                    playAt(1);
                  }
                },
              },
              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    fontSize: "0.8em",
                    fontFamily: "monospace",
                  },
                },
                m(IconPlay),
                "x200"
              ),
              m(
                "div",
                {
                  style: {
                    position: "absolute",
                    top: "0px",
                    left: "0px",
                    transform: "translate(0%,-100%)",
                    width: "100%",
                  },
                },
                playing &&
                  playingMs <= 1 &&
                  m(
                    HoldButtonAlt,
                    {
                      class_: "turbo",
                      active: playing && playingMs == 0,
                      onclick: () => playAt(0),
                    },
                    EMOJIS["rocket"]
                  )
              )
            )
          )
        )
      ),
    ],
  };
}

function HoldButton() {
  return {
    view: ({ attrs: { onclick, active }, children }) =>
      m(
        "button",
        {
          onclick,
          style: {
            border: "none",
            position: "relative",
            background: active ? "#bbb" : "#222",
            color: active ? "black" : "white",
            boxShadow: active ? "0 0 0 1px #bbb" : "0 0 0 1px #666",
          },
        },
        children
      ),
  };
}
function HoldButtonAlt() {
  return {
    view: ({ attrs: { onclick, active, class_ }, children }) =>
      m(
        "button",
        {
          onclick,
          class: class_,
          style: {
            border: "none",
            width: "100%",
            background: active ? "#e39500" : "#222",
            color: active ? "black" : "white",
            boxShadow: active ? "0 0 0 1px #e39500" : "0 0 0 1px #e39500",
          },
        },
        children
      ),
  };
}

function TimeFrag() {
  let val = null;
  let dom = null;
  let hourglass = null;
  return {
    oncreate: (v) => {
      dom = v.dom;
    },
    view: ({ attrs }) => {
      if (attrs.val != val) {
        val = attrs.val;
        dom?.animate([{ color: "white" }, { color: "#ccc" }], {
          duration: 300,
          easing: "ease-out",
        });

        hourglass?.animate(
          [
            { opacity: 0, transform: "rotate(0deg)" },
            { opacity: 1 },
            { transform: "rotate(0deg)" },
            { opacity: 1 },
            { opacity: 1 },
            { opacity: 1, transform: "rotate(180deg)" },
            { opacity: 0, transform: "rotate(180deg)" },
          ],
          { duration: 300, fill: "both" }
        );
      }
      return m(
        "div",
        {
          style: { fontWeight: "bold", color: "#ccc", position: "relative" },
        },
        "Day " + val,
        m(
          "div",
          {
            style: {
              position: "absolute",
              top: "0px",
              right: "-23px",
              opacity: "0",
            },
            oncreate: (v) => {
              hourglass = v.dom;
            },
          },
          EMOJIS.time
        )
      );
    },
  };
}

function Checkbox() {
  return {
    view: ({ attrs: { value, set, name } }) =>
      m(
        "div",
        {
          onclick: () => {
            set(!value);
          },
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            cursor: "pointer",
          },
        },
        m("div", {
          style: {
            width: "8px",
            height: "8px",
            marginRight: "5px",
            border: "1px solid white",
            background: value ? "white" : "black",
          },
        }),
        m(
          "div",
          {
            style: {
              color: value ? "white" : "#aaa",
            },
          },
          name
        )
      ),
  };
}

function SimBuilder({ attrs: { apply } }) {
  let o = {
    gov: false,
    money: true,
    bidding: false,
    overconsume: true,
    starvedPriority: false,
    truncate: false,
    qol2: false,
    resourcesCons: ["food", "water", "wood"],
    peopleOpt: [
      { producer: "food", money: 1000 },
      { producer: "water", money: 1000 },
      { producer: "wood", money: 1000 },
    ],
    prices: { food: 100, water: 100, wood: 100 },
  };

  apply(structuredClone(o));
  return {
    view: () =>
      m(
        "div",
        m(
          "div",
          { style: { fontWeight: "bold", fontSize: "1.2em" } },
          "Simulation builder"
        ),
        m(
          "div",
          m(
            "div",
            { style: { fontWeight: "bold", marginTop: "10px" } },
            "Resource consumption"
          ),
          ["food", "water", "wood"].map((r) => [
            m(Checkbox, {
              value: o.resourcesCons.includes(r),
              set: (e) => {
                let index = o.resourcesCons.findIndex((e) => e === r);
                if (index === -1 && e) {
                  o.resourcesCons.push(r);
                } else if (!e) {
                  o.peopleOpt = o.peopleOpt.filter((p) => p.producer != r);
                  o.resourcesCons.splice(index, 1);
                }
              },
              name: "Enable " + r + " " + EMOJIS[r],
            }),
            o.resourcesCons.includes(r) &&
              m(
                "div",
                { style: { display: "flex", alignItems: "center" } },
                m("div", { style: { marginRight: "10px" } }, "Initial price"),
                m("input", {
                  type: "number",
                  min: 1,
                  max: 10000,
                  step: 1,
                  oninput: (e) => (o.prices[r] = parseInt(e.target.value)),
                  value: o.prices[r] || 10,
                })
              ),
          ])
        ),
        m(
          "div",
          m(
            "div",
            { style: { fontWeight: "bold", marginTop: "10px" } },
            "People"
          ),
          m(
            "button",
            {
              onclick: () =>
                o.peopleOpt.splice(0, 0, { producer: null, money: 1000 }),
            },
            "New"
          ),
          o.peopleOpt.map((p, i) =>
            m(
              "div",
              {
                key: i,
                style: {
                  padding: "10px",
                  border: "1px solid #333",
                  margin: "20px 0px",
                },
              },

              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                  },
                },
                p.producer == "gov" ? EMOJIS["public"] : EMOJIS["farmer"],

                m(
                  "button",
                  { onclick: () => o.peopleOpt.splice(i, 1) },
                  "delete"
                ),

                m(
                  "div",
                  {
                    style: {
                      marginLeft: "10px",
                    },
                  },
                  p.producer ? EMOJIS[p.producer] + " worker" : "unemployed"
                )
              ),

              m(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                  },
                },
                m("div", { style: { marginRight: "5px" } }, "Set new job to:"),
                [...o.resourcesCons, "gov"].map(
                  (e) =>
                    p.producer != e &&
                    m(
                      "button",
                      {
                        onclick: () =>
                          o.peopleOpt.splice(i, 1, { ...p, producer: e }),
                      },
                      EMOJIS[e]
                    )
                )
              ),
              m(
                "div",
                { style: { display: "flex", alignItems: "center" } },
                m("div", { style: { marginRight: "10px" } }, "Initial money"),
                m("input", {
                  type: "number",
                  min: 1,
                  max: 10000,
                  step: 1,
                  oninput: (e) => (p.money = parseInt(e.target.value)),
                  value: p.money || 50,
                })
              )
            )
          )
        ),

        m(
          "div",
          m(
            "div",
            { style: { fontWeight: "bold", marginTop: "10px" } },
            "State"
          ),
          m(Checkbox, {
            value: o.gov,
            set: (e) => {
              if (e) {
                o.gov = { resources: { money: 1000 }, tax: 1 };
              } else {
                o.gov = false;
              }
            },
            name: "Enable state",
          }),

          o.gov && [
            m(Checkbox, {
              value: o.gov.print,
              set: (e) => {
                o.gov.print = e;
              },
              name: "Money printing",
            }),
            m(Checkbox, {
              value: o.gov.fluid,
              set: (e) => {
                o.gov.fluid = e;
              },
              name: "Relative state worker pay",
            }),
            m(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                },
              },
              m("div", "Tax"),
              m("input", {
                type: "number",
                min: 0,
                max: 100,
                step: 1,
                oninput: (e) => (o.gov.tax = parseInt(e.target.value) / 10),
                value: o.gov.tax * 10,
              }),
              m("div", "%")
            ),
          ]
        ),

        m("div", { style: { fontWeight: "bold", marginTop: "10px" } }, "Misc"),

        m(Checkbox, {
          value: o.money,
          set: (e) => {
            o.money = e;
          },
          name: "Enables money",
        }),

        m(Checkbox, {
          value: o.truncate,
          set: (e) => {
            o.truncate = e;
          },
          name: "Truncate money value when it reaches high numbers",
        }),

        m(Checkbox, {
          value: o.bidding,
          set: (e) => {
            o.bidding = e;
          },
          name: "Prices adapt to the market",
        }),

        m(Checkbox, {
          value: o.overconsume,
          set: (e) => {
            o.overconsume = e;
          },
          name: "People consume more when they have more",
        }),

        m(Checkbox, {
          value: o.starvedPriority,
          set: (e) => {
            o.starvedPriority = e;
          },
          name: "Gives starved buyer a priority",
        }),
        m(Checkbox, {
          value: o.qol2,
          set: (e) => {
            o.qol2 = e;
          },
          name: "Enable advanced QoL (sum of log)",
        }),
        m(Checkbox, {
          value: o.highNumbers,
          set: (e) => {
            o.highNumbers = e;
          },
          name: "Minimum price is 10 (avoid truncation errors, recommended for advanced QoL)",
        }),
        m(Checkbox, {
          value: o.sellMin,
          set: (e) => {
            o.sellMin = e;
          },
          name: "Minimum price set for survival",
        }),

        m("div", { style: { marginTop: "20px" } }),
        m(
          "div",
          m(
            "button",
            { onclick: () => apply(structuredClone(o)) },
            "Apply settings to the simulation below"
          )
        ),
        m("div", { style: { marginTop: "20px" } })
      ),
  };
}

function GovPayFrag({ attrs: { state, i, fast } }) {
  let seller = state.people[i];
  let sxy = i2xy(seller.id, state.count);
  let gxy = i2xy(state.count - 1, state.count);
  let anims = [];
  let speed = fast ? 200 : 1000;
  if (seller.producer !== "gov") return { view: () => m("div") };
  return {
    onbeforeremove: (v) => {
      return Promise.allSettled(anims);
    },
    view: () =>
      m(
        "div",
        {},
        m(
          "div",
          {
            oncreate: (v) => {
              let a = v.dom.animate(
                [
                  { transform: `translate(${gxy.x}px,${gxy.y}px)` },
                  { transform: `translate(${sxy.x}px,${sxy.y}px)` },
                ],
                { duration: speed, easing: "ease-in-out" }
              );
              a.finished.then(() => (v.dom.style.opacity = 0));
              anims.push(a.finished);
            },

            style: {
              fontSize: "3em",
              position: "absolute",
              top: "0px",
              left: "0px",
            },
          },
          EMOJIS["money"]
        )
      ),
  };
}

function DealAnimFrag({ attrs: { state, fast } }) {
  let buyer = state.people[state.msg.buyer];
  let seller = state.people[state.msg.seller];

  let bxy = i2xy(buyer.id, state.count);
  let sxy = i2xy(seller.id, state.count);
  let gxy = i2xy(state.count - 1, state.count);

  let anims = [];

  let speed = fast ? 200 : 1000;

  return {
    onbeforeremove: (v) => {
      return Promise.allSettled(anims);
    },
    view: () =>
      m(
        "div",
        {},
        m(
          "div",
          {
            oncreate: (v) => {
              let a = v.dom.animate(
                [
                  { transform: `translate(${bxy.x}px,${bxy.y}px)` },
                  { transform: `translate(${sxy.x}px,${sxy.y}px)` },
                ],
                { duration: speed, easing: "ease-in-out" }
              );
              a.finished.then(() => (v.dom.style.opacity = 0));
              anims.push(a.finished);
            },

            style: {
              fontSize: "2em",
              position: "absolute",
              top: "0px",
              left: "0px",
            },
          },
          EMOJIS["money"]
        ),
        m(
          "div",
          {
            oncreate: (v) => {
              let a = v.dom.animate(
                [
                  { transform: `translate(${sxy.x}px,${sxy.y}px)` },
                  { transform: `translate(${bxy.x}px,${bxy.y}px)` },
                ],
                { duration: speed, easing: "ease-in-out" }
              );
              a.finished.then(() => (v.dom.style.opacity = 0));
              anims.push(a.finished);
            },
            style: {
              fontSize: "2em",
              position: "absolute",
              top: "0px",
              left: "0px",
            },
          },
          EMOJIS[seller.producer]
        ),
        state.gov &&
          m(
            "div",
            {
              oncreate: (v) => {
                let p = wait(speed).then(() => {
                  v.dom.style.opacity = 1;
                  let a = v.dom.animate(
                    [
                      { transform: `translate(${sxy.x}px,${sxy.y}px)` },
                      { transform: `translate(${gxy.x}px,${gxy.y}px)` },
                    ],
                    { duration: speed, easing: "ease-in-out" }
                  );
                  a.finished.then(() => (v.dom.style.opacity = 0));
                  return a.finished;
                });

                anims.push(p);
              },

              style: {
                fontSize: "1.0em",
                position: "absolute",
                top: "0px",
                opacity: 0,
                left: "0px",
              },
            },
            EMOJIS["money"]
          )
      ),
  };
}

function StateFrag() {
  return {
    view: ({ attrs: { state, fast } }) =>
      m(
        "div",
        {
          style: {
            position: "absolute",
            top: "0px",
            left: "0px",
            transform: `translate(${
              i2xy(state.people.length, state.count).x
            }px,${i2xy(state.people.length, state.count).y}px)`,
          },
        },

        m(
          "div",
          { style: { display: "flex" } },
          m("div", { style: { fontSize: "2em" } }, EMOJIS["gov"]),
          m(
            "div",
            {
              style: {
                fontFamily: "monospace",
                borderLeft: "1px solid #555",
                paddingLeft: "2px",
              },
            },
            EMOJIS["money"] + state.gov.resources.money,
            m(
              "div",
              {
                style: { color: "#8dd3df", width: "22px" },
              },

              m(
                "div",
                {
                  style: {
                    fontFamily: "monospace",
                    lineHeight: "1.1em",
                    marginTop: "3px",
                    marginBottom: "2px",
                  },
                },
                (state.gov.autoTax
                  ? state.gov.autoTaxAmount * 10
                  : state.gov.tax * 10) + "%"
              ),
              m(
                "div",
                {
                  style: {
                    fontFamily: "monospace",
                    // fontSize: "0.8em",
                    paddingTop: "3px",
                    lineHeight: "1.1em",
                    borderTop: "1px solid",
                  },
                },
                "tax"
              )
            )
          )
        ),
        //Bubbles
        state.type === TYPE.GOV_PAY &&
          m(
            "div",
            {
              style: {
                position: "absolute",
                top: "0px",
                right: "0px",
                background: "#333",
                transform: "translate(90%,-90%)",
                padding: "10px",
                borderRadius: "15px",
                border: "1px solid #000",
              },
            },
            m("div", "I pay"),
            m("div", "state workers")
          ),
        state?.msg?.print != null &&
          m(
            "div",
            {
              style: {
                position: "absolute",
                top: "0px",
                right: "0px",
                background: "#333",
                transform: "translate(90%,-90%)",
                padding: "10px",
                borderRadius: "15px",
                border: "1px solid #000",
              },
            },
            m("div", { style: { whiteSpace: "pre" } }, "I print"),
            m("div", state.msg.print + EMOJIS["money"])
          )
      ),
  };
}

function PersonFrag() {
  let dead = false;
  return {
    view: ({ attrs: { state, i, fast } }) => {
      let msg = state.msg;
      let count = state.count;
      let produced = state.type === TYPE.TICK_PROD_CONS;
      let { resources, producer, alive } = state.people[i];

      if (alive) {
        dead = false;
      }

      return m(
        "div",
        {
          style: {
            // border: "1px solid #aaa",
            borderRadius: "5px",
            // padding: "3px",
            position: "absolute",
            top: "0px",
            left: "0px",
            transform: `translate(${i2xy(i, count).x}px,${i2xy(i, count).y}px)`,
          },
        },

        alive
          ? m(
              "div",
              { style: { display: "flex" }, key: "ali" },
              m(
                "div",
                { style: { marginRight: "2px" } },
                m(
                  "div",
                  { style: { fontSize: "2em" } },
                  producer === "gov" ? EMOJIS["public"] : EMOJIS["farmer"]
                ),
                state.qol2 &&
                  m(
                    "div",
                    { style: { fontSize: "0.8" } },
                    m(
                      "div",
                      {
                        style: { fontFamily: "monospace", lineHeight: "1em" },
                      },
                      "QoL"
                    ),
                    m(
                      "div",
                      {
                        style: { fontFamily: "monospace", lineHeight: "1em" },
                      },
                      state.people[i].QoL?.toFixed(1) || ""
                    )
                  )
              ),
              resources &&
                Object.keys(resources).length > 0 &&
                m(
                  "div",
                  {
                    style: { borderLeft: "1px solid #555", paddingLeft: "2px" },
                  },
                  Object.entries(resources).map(([k, v]) =>
                    m(ResourceFrag, {
                      name: k,
                      quantity: v,
                      producerOf: k == producer,
                      fast,
                    })
                  )
                )
            )
          : m(
              "div",
              { key: "dead", style: { fontSize: "2em", position: "relative" } },
              EMOJIS["dead"],
              m(
                "div",
                {
                  oncreate: (v) => {
                    if (!dead) {
                      dead = true;
                      v.dom.animate(
                        [
                          { transform: "translate(0px,0px)", opacity: 0 },
                          { opacity: 1 },
                          { transform: "translate(0px,-60px)", opacity: 0 },
                        ],
                        { duration: 800, fill: "forwards" }
                      );
                      v.dom.animate(
                        [
                          { transform: "translate(0px,0px)" },
                          { transform: "translate(5px,0px)" },
                          { transform: "translate(-5px,0px)" },
                          { transform: "translate(5px,0px)" },
                          { transform: "translate(-5px,0px)" },
                          { transform: "translate(0px,0px)" },
                        ],
                        { duration: 800, fill: "forwards", composite: "add" }
                      );
                    }
                  },
                  style: {
                    position: "absolute",
                    top: "0px",
                    left: "0px",
                  },
                },
                EMOJIS.ghost
              )
            ),

        !fast && msg?.seller == i
          ? m(
              "div",
              {
                key: "ad",
                style: {
                  position: "absolute",
                  top: "0px",
                  right: "0px",
                  background: "#333",
                  transform: "translate(90%,-90%)",
                  padding: "10px",
                  borderRadius: "15px",
                  border: msg.deal ? "1px solid #0F0" : "1px solid #000",
                },
              },
              m("div", { style: { whiteSpace: "pre" } }, "Who wants"),
              m("div", "1" + EMOJIS[producer] + "?")
            )
          : m("div", { key: "ad" }),
        !fast && producer && alive && produced
          ? m(
              "div",
              {
                key: "pr",
                style: {
                  position: "absolute",
                  top: "0px",
                  right: "0px",
                  background: "#333",
                  transform: "translate(90%,-90%)",
                  padding: "10px",
                  borderRadius: "15px",
                  border: "1px solid #000",
                },
              },
              m("div", "I made"),
              m("div", "10" + EMOJIS[producer])
            )
          : m("div", {
              key: "pr",
            }),
        !fast && msg?.buyer == i
          ? m(
              "div",
              {
                key: "i",
                style: {
                  position: "absolute",
                  top: "0px",
                  right: "0px",
                  background: "#333",
                  transform: "translate(90%,-90%)",
                  padding: "10px",
                  borderRadius: "15px",
                  border: msg.deal ? "1px solid #0F0" : "1px solid #000",
                },
              },
              "I do!"
            )
          : m("div", {
              key: "i",
            })
      );
    },
  };
}

function ResourceFrag() {
  let lastQuantity = 3;
  let plus;
  let minus;
  return {
    view: ({ attrs: { name, quantity, producerOf, fast } }) => {
      if (quantity > lastQuantity) {
        lastQuantity = quantity;
        plus?.animate(
          [
            { transform: "scale(1.5)", opacity: "1" },
            { transform: "scale(1)", opacity: "0" },
          ],
          {
            duration: fast ? 200 : 400,
            easing: "ease-out",
          }
        );
      }
      if (quantity < lastQuantity) {
        lastQuantity = quantity;
        minus?.animate(
          [
            { transform: "scale(1.5)", opacity: "1" },
            { transform: "scale(1)", opacity: "0" },
          ],
          {
            duration: fast ? 200 : 400,
            easing: "ease-out",
          }
        );
      }
      return m(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            fontFamily: "monospace",
            color: producerOf
              ? "#0F4"
              : quantity > 2
              ? "white"
              : quantity > 1
              ? "orange"
              : "red",
          },
        },
        EMOJIS[name] + quantity,
        m(
          "span",
          {
            oncreate: (v) => (plus = v.dom),
            style: {
              color: "#0F4",
              fontFamily: "monospace",
              fontWeight: "bold",
              opacity: 0,
            },
          },
          "+"
        ),
        m(
          "span",
          {
            oncreate: (v) => (minus = v.dom),
            style: {
              color: "#F00",
              fontFamily: "monospace",
              fontWeight: "bold",
              opacity: 0,
            },
          },
          "-"
        )
      );
    },
  };
}

/** Manually & finely tuned minimal pixel size of a simulation */
function count2size(count) {
  if (mobile && count <= 2) {
    let x = window.innerWidth - 175;
    let y = 100;
    return { x, y };
  }
  if (mobile && count <= 7) {
    let x = window.innerWidth - 175;
    let y = window.innerWidth - 175;
    return { x, y };
  }
  if (mobile) {
    let x = window.innerWidth - 175;
    let y = window.innerHeight * 0.5;
    return { x, y };
  }

  let x = W;
  let y = W;

  if (count <= 2) {
    x = 250;
    y = 100;
  } else if (count <= 5) {
    x = 250;
    y = 250;
  } else if (count <= 8) {
    x = 300;
    y = 300;
  } else if (count <= 11) {
    x = 320;
    y = 320;
  }
  return { x, y };
}

function i2xy(i, count) {
  let a = (2 * Math.PI * (i + 1)) / count;

  let size = count2size(count);
  let x = size.x * (0.5 + 0.5 * Math.cos(a));
  let y = size.y * (0.5 + 0.5 * Math.sin(a));

  if (count == 1) {
    x = size.x / 2;
    y = size.y / 2;
  }

  return { x, y };
}

function IconPause() {
  return {
    view: () =>
      m(
        "svg",
        { height: "10", width: "10" },
        m("polygon", {
          points: "0,0 0,10 3,10 3,0",
          style: { fill: "currentColor" },
        }),
        m("polygon", {
          points: "7,0 7,10 10,10 10,0",
          style: { fill: "currentColor" },
        })
      ),
  };
}

function IconPlay() {
  return {
    view: () =>
      m(
        "svg",
        { height: "10", width: "10" },
        m("polygon", {
          points: "0,0 10,5 0,10",
          style: { fill: "currentColor" },
        })
      ),
  };
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

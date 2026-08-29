import type { Totals } from '../db/ops'

/**
 * Logging a meal nobody weighed.
 *
 * A plate at a party, a work tray, a restaurant order: no recipe, no scale,
 * and no chance of one. What is available is the plate itself and a hand to
 * compare it against, which is enough — a palm of chicken is 100 g whoever
 * cooked it, and the error that leaves is far smaller than the error of not
 * logging the meal at all.
 *
 * Everything here is a generic stand-in, not the actual dish. That is the
 * point: the estimate is honest about being an estimate, and reports the range
 * rather than a figure that pretends to precision it has not got.
 */

export interface HandSize {
  label: string
  hint: string
  grams: number
}

export interface PlateChoice {
  label: string
  /** Per 100 g, from USDA generics for the commonest version of the thing. */
  per100: Totals
  /**
   * What someone would actually type looking for this.
   *
   * The list is deliberately generic — one entry stands in for every roasted
   * vegetable there is — but nobody searches for "roasted or grilled
   * vegetables". They search for the green beans on their plate. Spanish goes
   * in too, since half of what he eats he would name in it.
   */
  keywords?: string[]
}

export interface PlateCategory {
  key: string
  label: string
  sizes: HandSize[]
  choices: PlateChoice[]
}

const t = (kcal: number, protein: number, carbs: number, fat: number, fiber: number): Totals => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber,
})

/**
 * Hand measures, in cooked grams.
 *
 * These are the standard portion heuristics dietitians use, and they scale
 * with the person: a bigger hand goes with a bigger body and a bigger
 * requirement, which is exactly the correlation you want in a rule of thumb.
 */
const MEAT_SIZES: HandSize[] = [
  { label: 'A deck of cards', hint: 'a small piece', grams: 85 },
  { label: 'Your palm', hint: 'no fingers, ~1.5 cm thick', grams: 100 },
  { label: 'Two palms', hint: 'a generous helping', grams: 200 },
]

const STARCH_SIZES: HandSize[] = [
  { label: 'A few forkfuls', hint: 'you barely touched it', grams: 40 },
  { label: 'A cupped hand', hint: 'a normal scoop', grams: 100 },
  { label: 'Two cupped hands', hint: 'a full side', grams: 200 },
]

const VEG_SIZES: HandSize[] = [
  { label: 'A serving spoon', hint: 'one scoop', grams: 70 },
  { label: 'A closed fist', hint: 'a proper portion', grams: 150 },
  { label: 'Half the plate', hint: 'piled up', grams: 250 },
]

const EXTRA_SIZES: HandSize[] = [
  { label: 'A thumb', hint: 'a little', grams: 15 },
  { label: 'Two thumbs', hint: 'a fair amount', grams: 30 },
  { label: 'Covered in it', hint: 'sauced or fried', grams: 60 },
]

/**
 * A whole dish, measured against the plate it came on.
 *
 * Some meals cannot honestly be taken apart. A bolognese is pasta and sauce
 * and mince in a ratio the kitchen chose, and guessing each separately
 * multiplies three errors instead of making one. Where a combined figure
 * exists it beats assembling the plate from its parts.
 */
const DISH_SIZES: HandSize[] = [
  { label: 'Half a plate', hint: 'a modest serving', grams: 150 },
  { label: 'A full plate', hint: 'the normal order', grams: 300 },
  { label: 'A big plate', hint: 'piled high, or seconds', grams: 450 },
]

const SWEET_SIZES: HandSize[] = [
  { label: 'A bite', hint: 'a taste of what someone else had', grams: 25 },
  { label: 'A slice or a scoop', hint: 'the normal serving', grams: 80 },
  { label: 'A proper portion', hint: 'you did not hold back', grams: 160 },
]

// Drinks are the one thing on a table that comes in known sizes, so the
// measures are the vessel rather than a hand. Millilitres and grams are close
// enough to interchangeable for anything you would drink with a meal.
const DRINK_SIZES: HandSize[] = [
  { label: 'A small glass', hint: 'about 250 ml', grams: 250 },
  { label: 'A can or bottle', hint: 'about 355 ml', grams: 355 },
  { label: 'A pint or large glass', hint: 'about 500 ml', grams: 500 },
]

export const PLATE: PlateCategory[] = [
  {
    key: 'dish',
    label: 'A whole dish, if it came as one',
    sizes: DISH_SIZES,
    choices: [
      { label: 'Pasta with meat sauce', per100: t(121, 5.8, 16.4, 3.6, 1.6) , keywords: 'spaghetti bolognese lasagne ragu meatballs noodles pasta'.split(' ') },
      { label: 'Rice with meat and vegetables', per100: t(150, 8, 18, 5, 1.5) , keywords: 'stir fry fried rice paella biryani arroz risotto'.split(' ') },
      { label: 'Stew, curry or casserole', per100: t(120, 8, 8, 6, 1.5) , keywords: 'chili curry goulash sancocho guiso stew casserole'.split(' ') },
      { label: 'Pizza', per100: t(266, 11, 33, 10, 2.3) , keywords: 'pizza slice calzone'.split(' ') },
      { label: 'Burger or filled sandwich', per100: t(250, 13, 25, 11, 1.5) , keywords: 'burger sandwich sub wrap panini hot dog taco burrito hamburguesa'.split(' ') },
      { label: 'Salad with meat or cheese', per100: t(120, 8, 6, 7, 2) , keywords: 'caesar salad ensalada'.split(' ') },
      { label: 'Soup', per100: t(55, 3, 6, 2, 1) , keywords: 'soup broth sopa ramen caldo'.split(' ') },
    ],
  },
  {
    key: 'protein',
    label: 'Meat or fish',
    sizes: MEAT_SIZES,
    choices: [
      { label: 'Chicken, lean', per100: t(165, 31, 0, 3.6, 0) , keywords: 'chicken breast grilled chicken pollo turkey pavo'.split(' ') },
      { label: 'Chicken, with skin', per100: t(232, 23.3, 0, 14.7, 0) , keywords: 'chicken thigh wing roast chicken drumstick'.split(' ') },
      { label: 'Chicken, fried or breaded', per100: t(230, 23.5, 6, 12.4, 0.1) , keywords: 'fried chicken nuggets schnitzel milanesa katsu breaded'.split(' ') },
      { label: 'Beef or pork', per100: t(240, 25.8, 0, 14.3, 0) , keywords: 'beef steak pork mince ground beef lamb ribs carne cerdo res'.split(' ') },
      { label: 'Fish', per100: t(206, 22.1, 0, 12.4, 0) , keywords: 'fish salmon tuna cod tilapia pescado atun'.split(' ') },
      { label: 'Prawns or shellfish', per100: t(99, 24, 0.2, 0.3, 0) , keywords: 'prawns shrimp camaron crab mussels seafood marisco'.split(' ') },
      { label: 'Egg', per100: t(196, 13.6, 0.8, 14.8, 0) , keywords: 'egg huevo omelette scrambled fried egg tortilla de huevo'.split(' ') },
      { label: 'Sausage or chorizo', per100: t(300, 13, 2, 27, 0) , keywords: 'sausage chorizo bacon salami pepperoni hot dog salchicha'.split(' ') },
      { label: 'Ham or deli meat', per100: t(145, 18, 2, 7, 0) , keywords: 'ham deli jamon turkey slices prosciutto'.split(' ') },
      { label: 'Tofu', per100: t(144, 17.3, 2.8, 8.7, 2.3) , keywords: 'tofu tempeh soy'.split(' ') },
      { label: 'Beans or lentils', per100: t(132, 8.9, 23.7, 0.5, 8.7) , keywords: 'beans lentils chickpeas frijoles black beans hummus garbanzos'.split(' ') },
    ],
  },
  {
    key: 'starch',
    label: 'Rice, potato, bread',
    sizes: STARCH_SIZES,
    choices: [
      { label: 'Rice', per100: t(130, 2.7, 28.2, 0.3, 0.4) , keywords: 'rice arroz white rice brown rice'.split(' ') },
      { label: 'Pasta or noodles', per100: t(158, 5.8, 30.9, 0.9, 1.8) , keywords: 'pasta spaghetti macaroni noodles ramen fideos'.split(' ') },
      { label: 'Potato', per100: t(86, 1.7, 20, 0.1, 1.8) , keywords: 'potato mashed boiled potato papa patata'.split(' ') },
      { label: 'Sweet potato', per100: t(90, 2, 20.7, 0.2, 3.3) , keywords: 'sweet potato yam batata camote'.split(' ') },
      { label: 'Bread', per100: t(270, 9.4, 49.2, 3.6, 2.3) , keywords: 'bread roll bun baguette toast pan'.split(' ') },
      { label: 'Arepa or tortilla', per100: t(219, 5.5, 37.1, 5.4, 2.6) , keywords: 'arepa tortilla taco shell pita naan wrap flatbread'.split(' ') },
      { label: 'Plantain, fried', per100: t(309, 1.5, 49.2, 11.8, 3.5) , keywords: 'plantain tostones patacones maduros platano frito'.split(' ') },
      { label: 'Plantain, boiled', per100: t(121, 1.1, 29.1, 0.1, 2.3) , keywords: 'plantain platano cocido boiled plantain'.split(' ') },
      { label: 'Quinoa or couscous', per100: t(120, 4.4, 21.3, 1.9, 2.8) , keywords: 'quinoa couscous bulgur barley'.split(' ') },
      { label: 'Sweetcorn', per100: t(96, 3.4, 21, 1.5, 2.4) , keywords: 'corn sweetcorn maize elote choclo mazorca'.split(' ') },
      { label: 'Chips or fries', per100: t(312, 3.4, 41, 15, 3.8) , keywords: 'chips fries crisps wedges hash brown papas fritas'.split(' ') },
    ],
  },
  {
    key: 'veg',
    label: 'Vegetables',
    sizes: VEG_SIZES,
    choices: [
      { label: 'Cooked vegetables', per100: t(65, 2.9, 13.1, 0.1, 4.4) , keywords: 'green beans broccoli carrots peas spinach cauliflower courgette zucchini verduras vegetables'.split(' ') },
      { label: 'Roasted or grilled vegetables', per100: t(110, 2.5, 12, 6, 3.5) , keywords: 'roasted green beans mushrooms peppers asparagus aubergine grilled vegetables champinones setas verduras asadas'.split(' ') },
      { label: 'Salad leaves', per100: t(17, 1.2, 3.2, 0.3, 1.8) , keywords: 'salad lettuce rocket arugula spinach ensalada'.split(' ') },
      { label: 'Raw vegetables', per100: t(30, 1.4, 6.5, 0.2, 2.2) , keywords: 'raw vegetables cucumber tomato carrot sticks crudites pepino'.split(' ') },
    ],
  },
  {
    key: 'extra',
    label: 'Cheese, sauce, dressing',
    sizes: EXTRA_SIZES,
    choices: [
      { label: 'Cheese', per100: t(408, 23.3, 2.4, 34, 0) , keywords: 'cheese queso parmesan cheddar mozzarella feta'.split(' ') },
      { label: 'Creamy sauce or dressing', per100: t(350, 1.5, 6, 36, 0) , keywords: 'alfredo ranch aioli sour cream crema dressing mayonesa'.split(' ') },
      { label: 'Mayonnaise', per100: t(680, 1, 0.6, 75, 0) , keywords: 'mayonnaise mayo mayonesa'.split(' ') },
      { label: 'Guacamole or avocado', per100: t(157, 2, 8.6, 14.2, 6.7) , keywords: 'guacamole avocado aguacate palta'.split(' ') },
      { label: 'Tomato or stock sauce', per100: t(70, 1.6, 9, 3, 1.2) , keywords: 'marinara salsa gravy tomato sauce hogao'.split(' ') },
    ],
  },
  {
    key: 'sweet',
    label: 'Pudding, cake, something sweet',
    sizes: SWEET_SIZES,
    choices: [
      { label: 'Cake or pastry', per100: t(371, 4.2, 50.7, 16.4, 1.6) , keywords: 'cake pastry brownie muffin donut torta pie tart'.split(' ') },
      { label: 'Biscuits or cookies', per100: t(480, 5.7, 64, 23, 2) , keywords: 'biscuits cookies galletas'.split(' ') },
      { label: 'Ice cream', per100: t(207, 3.5, 23.6, 11, 0.7) , keywords: 'ice cream helado gelato'.split(' ') },
      { label: 'Chocolate', per100: t(546, 4.9, 61, 31, 3.4) , keywords: 'chocolate truffle candy sweets chocolatina'.split(' ') },
      { label: 'Fruit', per100: t(60, 0.7, 15, 0.2, 2) , keywords: 'fruit fruta berries melon'.split(' ') },
    ],
  },
  {
    key: 'drink',
    label: 'Something to drink',
    sizes: DRINK_SIZES,
    choices: [
      { label: 'Soft drink, sugared', per100: t(42, 0, 10.6, 0, 0) , keywords: 'soda coke cola sprite gaseosa soft drink fizzy'.split(' ') },
      { label: 'Fruit juice', per100: t(45, 0.5, 10.9, 0.1, 0.2) , keywords: 'juice jugo orange juice smoothie zumo'.split(' ') },
      { label: 'Beer', per100: t(43, 0.5, 3.6, 0, 0) , keywords: 'beer cerveza lager ale'.split(' ') },
      { label: 'Wine', per100: t(85, 0.1, 2.6, 0, 0) , keywords: 'wine vino'.split(' ') },
      { label: 'Coffee with milk', per100: t(55, 3, 5, 2.5, 0) , keywords: 'coffee latte cappuccino cafe con leche tea with milk'.split(' ') },
    ],
  },
]

export interface PlateItem {
  key: string
  label: string
  grams: number
  per100: Totals
}

/**
 * Anything cooked for a crowd is cooked in fat, and it is the line people
 * leave out. A teaspoon is 40 kcal — usually more than the rice someone
 * skipped to be virtuous.
 */
export const OIL_PER100 = t(884, 0, 0, 100, 0)
export const OIL_GRAMS = 5

export function plateTotals(items: PlateItem[], oiled: boolean): Totals {
  const all = oiled ? [...items, { key: 'oil', label: 'Cooked in oil', grams: OIL_GRAMS, per100: OIL_PER100 }] : items
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  for (const i of all) {
    const f = i.grams / 100
    out.kcal += i.per100.kcal * f
    out.protein += i.per100.protein * f
    out.carbs += i.per100.carbs * f
    out.fat += i.per100.fat * f
    out.fiber += i.per100.fiber * f
  }
  return out
}

/**
 * How wrong this could be.
 *
 * Judging a portion by eye lands within about 30% for someone paying
 * attention, and the generic stand-in adds a little on top. Saying so is
 * worth more than a decimal place: it tells you when a meal is worth a second
 * thought and when it is inside the noise of the day.
 */
export function plateError(items: PlateItem[], oiled: boolean): number {
  return Math.round(plateTotals(items, oiled).kcal * 0.3)
}

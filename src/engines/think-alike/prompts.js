// A small, fixed prompt bank — "name something" style, in the spirit of
// Herd Mentality: there's rarely one right answer, the point is guessing
// what everyone else will say.
const PROMPTS = [
  'Name a vegetable',
  'Name a type of pasta',
  'Name a planet',
  'Name a fast food chain',
  'Name a dog breed',
  'Name a kitchen appliance',
  'Name a color',
  'Name a continent',
  'Name a movie genre',
  'Name a beach activity',
  'Name a musical instrument',
  'Name a type of shoe',
  'Name a social media app',
  'Name a breakfast food',
  'Name a sport',
  'Name a superhero',
  'Name a pizza topping',
  'Name a card game',
  'Name a season',
  'Name a type of tree',
].map((text, i) => ({ id: `prompt-${i}`, text }));

function listPrompts() {
  return PROMPTS;
}

module.exports = { listPrompts };

// Offline survival guide. Fixed, pre-written text (never generated on the fly).
// Based on standard public guidance from the American Red Cross, American Heart
// Association, CDC, National Weather Service (NWS), FEMA / Ready.gov and
// FoodSafety.gov. It does NOT replace professional medical help.

export const DISCLAIMER = 'This guide is basic, general safety information. It does not replace professional medical help. In an emergency call 911 first. If a call will not go through, try texting 911.';

export const GUIDE = [
  {
    id: 'firstaid', title: 'First aid',
    sections: [
      ['Before anything', [
        'Make sure the scene is safe for you (traffic, water, power lines, fire).',
        'Call 911. If calls fail, try texting 911, or send someone to the nearest fire station or hospital (use the Nearest buttons).',
        'Poison Control (US): 1-800-222-1222.',
      ]],
      ['Heavy bleeding', [
        'Press hard on the wound with a clean cloth or gauze, and keep pressing.',
        'If blood soaks through, add more cloth on top. Do not lift off the first layer.',
        'For an arm or leg that will not stop bleeding with pressure: if you have a tourniquet and know how to use it, put it 2–3 inches above the wound (not on a joint), tighten until bleeding stops, and note the time.',
      ]],
      ['Not breathing / no pulse (adult CPR)', [
        'Tap and shout. If no response and not breathing normally, call 911 and get an AED if one is near.',
        'Hands-only CPR: push hard and fast in the center of the chest, about 2 inches deep, 100–120 pushes a minute (the beat of "Stayin\' Alive").',
        'Keep going until help arrives, an AED is ready, or the person starts breathing.',
      ]],
      ['Choking (adult)', [
        'If the person cannot cough, speak or breathe: give 5 firm back blows between the shoulder blades, then 5 abdominal thrusts (fist just above the belly button, quick inward-upward pulls).',
        'Repeat until the object comes out. If they pass out, call 911 and start CPR.',
      ]],
      ['Burns', [
        'Cool the burn under cool (not ice-cold) running water for at least 10 minutes.',
        'Remove rings or tight items near the burn before it swells.',
        'Cover loosely with a clean dressing or plastic wrap. Do not put butter, oil or ice on it.',
        'Get medical help for large or deep burns, or burns on the face, hands, feet, groin, or a burn on a child or older adult.',
      ]],
      ['Shock', [
        'Signs: pale, cool, clammy skin; fast breathing; weakness; confusion.',
        'Call 911. Have the person lie down, keep them warm, and do not give food or drink.',
      ]],
      ['Cuts and floodwater', [
        'Clean small cuts with clean (bottled or boiled) water and soap, then cover.',
        'Floodwater carries germs. Keep wounds out of it. See a doctor if a wound gets red, swollen, hot or oozes.',
        'Ask about a tetanus shot if your last one was more than 5 years ago and the wound is dirty.',
      ]],
    ],
  },
  {
    id: 'flood', title: 'Flood',
    sections: [
      ['Turn around, don\'t drown', [
        'Never walk, swim or drive through floodwater. You cannot tell how deep it is or if the road under it is gone.',
        'About 6 inches of fast-moving water can knock an adult down. About 12 inches of rushing water can carry away most cars, and 2 feet can carry away SUVs and trucks (NWS).',
        'In Houston, underpasses, low-water crossings and roads near bayous flood first — this app warns about those on routes, but it cannot see if they are flooded right now.',
      ]],
      ['If you are in a car', [
        'If the car stalls in rising water and you can get out safely, leave it and move to higher ground.',
        'If the car is trapped in fast-moving water, stay inside. If water rises inside the car, get onto the roof and call 911.',
      ]],
      ['If you are at home', [
        'Move to the highest floor. Do not go into a closed attic — you can get trapped. Go onto the roof only if you must, and call for help.',
        'If it is safe and you are not standing in water, turn off power at the main breaker.',
        'Floodwater can hide downed power lines, sharp debris, sewage, chemicals, snakes and floating fire-ant clumps. Stay out of it, and wash with soap and clean water if you touch it.',
      ]],
      ['After the flood', [
        'Go back only when officials say it is safe.',
        'If you smell gas, leave right away and call from outside.',
        'Throw away food that touched floodwater. Take photos of damage for insurance.',
      ]],
    ],
  },
  {
    id: 'heat', title: 'Extreme heat',
    sections: [
      ['Heat stroke — EMERGENCY', [
        'Signs: very high body temperature (103°F or more); hot, red, dry or damp skin; fast, strong pulse; headache; dizziness; nausea; confusion; passing out.',
        'Call 911. Move the person somewhere cooler. Cool them with cool wet cloths or a cool bath.',
        'Do not give the person anything to drink.',
      ]],
      ['Heat exhaustion', [
        'Signs: heavy sweating; cold, pale, clammy skin; fast, weak pulse; nausea or vomiting; muscle cramps; tiredness; dizziness; headache; fainting.',
        'Move to a cooler place, loosen clothes, put cool wet cloths on the body, and sip water.',
        'Get medical help right away if they are throwing up, getting worse, or symptoms last more than 1 hour.',
      ]],
      ['Staying safe', [
        'Drink water regularly — do not wait until you are thirsty. Avoid alcohol and very sugary drinks.',
        'Stay in shade or the coolest room, usually the lowest floor. Wear light, loose clothing.',
        'Do heavy work only in the early morning or evening. Rest often.',
        'When it is very hot, a fan alone may not prevent heat illness. A cool shower or bath helps more.',
        'Never leave a person or pet in a parked car. Check on older neighbors twice a day.',
      ]],
    ],
  },
  {
    id: 'power', title: 'Power outage',
    sections: [
      ['Carbon monoxide (CO) can kill', [
        'Run generators ONLY outdoors, at least 20 feet from windows, doors and vents. Never inside a home, garage or carport, even with the door open.',
        'Never use a grill, camp stove or gas oven to heat your home.',
        'CO has no smell. Headache, dizziness, weakness, nausea or confusion can mean CO poisoning: get everyone into fresh air and call 911.',
        'Use a battery-powered CO alarm.',
      ]],
      ['Food and medicine', [
        'Keep the fridge and freezer closed. A closed fridge keeps food cold for about 4 hours. A full freezer keeps food frozen for about 48 hours (about 24 hours if half full).',
        'Throw out meat, fish, eggs, milk and leftovers that have been above 40°F for more than 2 hours. When in doubt, throw it out.',
        'If you have medicine that must stay cold (like insulin), ask a pharmacist how long it is safe at room temperature.',
      ]],
      ['Water', [
        'If there is a boil-water notice: bring water to a rolling boil for 1 minute, then let it cool.',
        'No way to boil? Add plain, unscented household bleach: 8 drops of 6% bleach (or 6 drops of 8.25% bleach) per gallon of clear water. Stir and wait 30 minutes before drinking.',
      ]],
      ['Around the house and roads', [
        'Use flashlights, not candles.',
        'Unplug electronics to protect them from a power surge. Leave one light switched on so you know when power is back.',
        'Stay far away from downed power lines (at least 30–35 feet). Always assume they are live.',
        'If traffic lights are out, treat the intersection as an all-way stop.',
      ]],
    ],
  },
];

export const CHECKLIST = [
  ['Water and food', [
    ['water', 'Water: 1 gallon per person per day, for several days'],
    ['food', 'Food that does not need cooking or a fridge, for several days'],
    ['opener', 'Manual can opener'],
    ['pets', 'Food and water for pets'],
  ]],
  ['Power and light', [
    ['flashlight', 'Flashlight and extra batteries'],
    ['radio', 'Battery or hand-crank radio (NOAA Weather Radio)'],
    ['powerbank', 'Phone chargers and a charged power bank'],
    ['charge', 'Charge phone, power bank and laptop before the storm'],
    ['co', 'Battery-powered carbon monoxide (CO) alarm'],
  ]],
  ['Health', [
    ['firstaidkit', 'First aid kit'],
    ['meds', 'Prescription medicines and glasses'],
    ['sanitation', 'Wet wipes, garbage bags and plastic ties'],
    ['masks', 'Dust masks'],
  ]],
  ['Papers and money', [
    ['cash', 'Cash in small bills (card machines need power)'],
    ['docs', 'ID, insurance and important papers in a waterproof bag'],
    ['numbers', 'Important phone numbers written on paper'],
  ]],
  ['Tools', [
    ['whistle', 'Whistle to call for help'],
    ['tools', 'Wrench or pliers to turn off utilities'],
    ['tape', 'Duct tape and plastic sheeting'],
  ]],
  ['Before the storm', [
    ['gas', 'Fill the car gas tank'],
    ['tub', 'Fill the bathtub with water for flushing and washing'],
    ['freeze', 'Freeze water bottles to keep food cold longer'],
    ['zone', 'Check (while online) if you live in a hurricane evacuation zone'],
    ['mapdata', 'Update this map\'s data while you still have internet'],
    ['saved', 'Save Home, family and meeting points in this app'],
    ['plan', 'Agree on a meeting point with family in case phones are down'],
  ]],
];

import type { InstrumentId } from '../lib/settings';
import type { Controller } from './common';
import { PianoController } from './piano';
import { DrumController } from './drums';
import { GuitarController } from './guitar';
import { SynthController } from './synth';
import { PercussionController } from './percussion';

export function createController(id: InstrumentId): Controller {
  switch (id) {
    case 'piano': return new PianoController();
    case 'drums': return new DrumController();
    case 'guitar': return new GuitarController();
    case 'synth': return new SynthController();
    case 'percussion': return new PercussionController();
  }
}

export const INSTRUMENTS: { id: InstrumentId; name: string; blurb: string; how: string[] }[] = [
  {
    id: 'piano', name: 'Air Piano', blurb: 'Sampled grand, electric piano, organ and synth keys.',
    how: ['Move your index finger left or right to choose a key.', 'Dip your fingertip below the key line to play, and lift it to release.', 'Both hands play independently. Chord assist turns one finger into a full chord.'],
  },
  {
    id: 'drums', name: 'Air Drums', blurb: 'Nine-piece kit with acoustic, vintage and 808 packs.',
    how: ['Tap down sharply in the air over a pad.', 'Faster strikes play louder.', 'Your hand has to slow down or lift before the next hit, so a resting hand never retriggers.'],
  },
  {
    id: 'guitar', name: 'Air Guitar', blurb: 'Acoustic, clean, distorted and bass. Strum real chord shapes.',
    how: ['Your left hand height picks the chord from the column.', 'Swing your right hand down or up through the strings to strum.', 'Make a fist with the strumming hand to palm-mute.'],
  },
  {
    id: 'synth', name: 'Air Synth', blurb: 'Theremin-style synth: pitch, filter, volume and motion modulation.',
    how: ['Move your hand horizontally to change pitch.', 'Hand height controls brightness or volume.', 'An open hand plays and a fist stops. Shake for vibrato.'],
  },
  {
    id: 'percussion', name: 'Air Percussion', blurb: 'Bongos, congas, tambourine, claps, shaker, cowbell and electronic hits.',
    how: ['Tap down over a pad to play it.', 'Make a fist and shake side to side to play the shaker.', 'Choose a layout to combine instruments.'],
  },
];

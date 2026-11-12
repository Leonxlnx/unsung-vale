// Connects game events to sound: which effect plays for what, which music fits the moment,
// and how the ambience follows the player through the valley.
import * as THREE from 'three';

export function connectAudio(audio, game, ui, falls) {
  const right = new THREE.Vector3(), cam = new THREE.Vector3();
  const at = (name, pos, opts) => audio.sfxAt(name, pos, cam, right, opts);
  let triumph = 0;

  ui.onSound = (name) => audio.sfx(name, { volume: name === 'ui_hover' ? 0.25 : 0.5, spread: 0.02 });

  // When each strike's blade is at its fastest, so the whoosh sits on the cut, not the wind-up.
  const CUT = [0.1, 0.09, 0.2, 0.28];
  game.on((type, d) => {
    const p = game.player;
    if (type === 'player') {
      if (d.type === 'step') {
        // Paving and bridges ring differently from turf. Running adds the creak of his gear.
        const stone = p.pos.y - game.terrain.heightAt(p.pos.x, p.pos.z) > 0.25;
        audio.sfx(stone ? 'step_stone' : 'step_grass', { volume: d.soft ? 0.14 : d.sprint ? 0.36 : 0.22 + 0.08 * (d.run ?? 1), spread: 0.12, wet: stone ? 0.2 : 0.08 });
        if (!d.soft && Math.random() < 0.6) audio.sfx('gear', { volume: 0.1 + 0.06 * (d.run ?? 1), spread: 0.2 });
      }
      if (d.type === 'swing') {
        const heavy = d.index >= 2;
        audio.sfx(heavy ? 'swing_heavy' : 'swing', { volume: heavy ? 0.6 : 0.5, delay: CUT[d.index] ?? 0.1, pitch: d.index === 1 ? 1.06 : 1 });
        audio.sfx('gear', { volume: 0.16, spread: 0.2 });
      }
      if (d.type === 'plungeStart') audio.sfx('swing_heavy', { volume: 0.6, delay: 0.12 });
      if (d.type === 'plunge') { audio.sfx('hit_heavy', { volume: 0.7, wet: 0.35 }); audio.sfx('slam', { volume: 0.5, wet: 0.35 }); audio.sfx('land_heavy', { volume: 0.5 }); }
      if (d.type === 'slamHit') { audio.sfx('hit_heavy', { volume: 0.5, wet: 0.3 }); audio.sfx('land_heavy', { volume: 0.4 }); }
      if (d.type === 'roll') { audio.sfx('roll', { volume: 0.32 }); audio.sfx('gear', { volume: 0.2, delay: 0.12 }); }
      if (d.type === 'jump') { audio.sfx('jump', { volume: 0.3 }); audio.sfx('gear', { volume: 0.12 }); }
      if (d.type === 'land') {
        const fell = d.fell ?? 0;
        audio.sfx(fell > 4 ? 'land_heavy' : 'land', { volume: Math.min(0.7, 0.3 + fell * 0.04) });
        if (fell > 7) audio.sfx('hit_heavy', { volume: 0.25 });
        audio.sfx('gear', { volume: 0.16 });
      }
      if (d.type === 'hurt') audio.sfx('hurt', { volume: 0.7 });
      if (d.type === 'death') audio.sfx('death', { volume: 0.8, wet: 0.4 });
      if (d.type === 'respawn') audio.sfx('respawn', { volume: 0.45 });
      if (d.type === 'pulse') audio.sfx('pulse', { volume: 0.7, wet: 0.35 });
    }
    if (type === 'hit') {
      // Steel on crystal: the bright ring of the blade, a chip of crystal, and weight under the big ones.
      audio.sfx('hit', { volume: d.heavy ? 0.75 : 0.65 });
      audio.sfx('crystal', { volume: 0.34, delay: 0.02 });
      if (d.heavy) audio.sfx('hit_heavy', { volume: 0.5 });
      if (d.enemy?.def.boss) audio.sfx('block', { volume: 0.3, wet: 0.3 });        // the colossus rings like struck armour
    }
    if (type === 'enemy') {
      const e = d.enemy, boss = e?.def.boss;
      if (d.type === 'death' && e) {
        at('shatter', e.pos, { volume: 0.85, range: 18 });
        if (boss) { audio.sfx('shatter_big', { volume: 1, wet: 0.4 }); audio.sfx('slam', { volume: 0.8, wet: 0.4 }); audio.sfx('shatter_big', { volume: 0.8, delay: 0.35, wet: 0.4 }); }
      }
      if (d.type === 'charge' && e) at('enemy_charge', e.pos, { volume: 0.6, range: 14, pitch: (boss ? 0.8 : 1) * 0.95 / Math.max(0.5, e.def.windup) });
      if (d.type === 'attack' && e && !e.def.ranged && e.attackKind !== 2) at('enemy_swing', e.pos, { volume: 0.6, range: 12, pitch: boss ? 0.75 : 1 });
      if (d.type === 'shot' && e) at('enemy_shot', e.pos, { volume: 0.5, range: 16 });
      if (d.type === 'shotHit') at('enemy_shot_hit', d.pos, { volume: 0.5, range: 12 });
      if (d.type === 'slam' && e) at('slam', e.pos, { volume: 1, range: 24 });
      if (d.type === 'wake' && e) at('enemy_wake', e.pos, { volume: boss ? 0.9 : 0.6, range: 18, pitch: boss ? 0.7 : 1 });
    }
    if (type === 'tuned') {
      audio.sfx('spire_tune', { volume: 1, wet: 0.45 });
      audio.sfx('restore', { volume: 0.7, wet: 0.3 });
      audio.playMusic('triumph', 1.2);
      triumph = 1;
      if (d.spire.id === 'cantor') setTimeout(() => audio.sfx('bridge', { volume: 0.8 }), 1800);
    }
    if (type === 'note') audio.sfx('pickup', { volume: 0.5, pitch: d.pitch, spread: 0, wet: 0.4 });
    if (type === 'objective' && game.state === 'playing') audio.sfx('objective', { volume: 0.4, wet: 0.3 });
    if (type === 'respawn') audio.sfx('respawn', { volume: 0.45, wet: 0.3 });
  });
  audio.onMusicEnd = () => { triumph = 0; };

  return function update(dt) {
    if (!audio.ready) return;
    const p = game.player, c = game.pipe.camera;
    cam.setFromMatrixPosition(c.matrixWorld);
    right.set(1, 0, 0).applyQuaternion(c.quaternion);
    const here = game.state === 'home' ? cam : p.pos;

    // How deep inside a silenced zone we are.
    let mute = 0;
    for (const s of game.spires) {
      if (s.zone.w <= 0) continue;
      const d = Math.hypot(here.x - s.x, here.z - s.z);
      mute = Math.max(mute, s.zone.w * Math.min(1, Math.max(0, (s.zone.z - d) / 10)));
    }
    // Nearness to the closest waterfall, top or bottom.
    let fall = 0;
    for (const f of falls.falls) {
      const d = Math.min(Math.hypot(here.x - f.top[0], here.y - f.top[1], here.z - f.top[2]), Math.hypot(here.x - f.end[0], here.y - f.end[1], here.z - f.end[2]));
      fall = Math.max(fall, 1 / (1 + (d / 55) ** 2));
    }
    audio.update(dt, { mute, fall: Math.min(1, fall * 1.15), lake: here.y < 8 ? 1 : 0 });
    // The tone of a spire being tuned, for as long as the key is held.
    audio.hold('tune_hold', game.state === 'playing' && !!game.prompt && game.input.held.has('interact'), 0.42);

    if (triumph) return;
    if (game.state === 'home' || game.state === 'intro') audio.playMusic('home');
    else {
      const fighting = game.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.state !== 'return' && e.pos.distanceTo(p.pos) < 45);
      audio.playMusic(fighting ? 'combat' : 'explore', fighting ? 1.2 : 4);
    }
  };
}

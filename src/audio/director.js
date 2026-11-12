// Connects game events to sound: which effect plays for what, which music fits the moment,
// and how the ambience follows the player through the valley.
import * as THREE from 'three';

export function connectAudio(audio, game, ui, falls) {
  const right = new THREE.Vector3(), cam = new THREE.Vector3();
  const at = (name, pos, opts) => audio.sfxAt(name, pos, cam, right, opts);
  let triumph = 0;

  ui.onSound = (name) => audio.sfx(name, { volume: name === 'ui_hover' ? 0.25 : 0.5, spread: 0.02 });

  game.on((type, d) => {
    const p = game.player;
    if (type === 'player') {
      if (d.type === 'step') {
        // Paving and bridges ring differently from turf.
        const stone = p.pos.y - game.terrain.heightAt(p.pos.x, p.pos.z) > 0.25;
        audio.sfx(stone ? 'step_stone' : 'step_grass', { volume: p.sprinting ? 0.5 : 0.36, spread: 0.14 });
      }
      if (d.type === 'swing') audio.sfx('swing', { volume: 0.6, pitch: d.index >= 2 ? 0.85 : 1.05 });
      if (d.type === 'roll') audio.sfx('roll', { volume: 0.55 });
      if (d.type === 'jump') audio.sfx('jump', { volume: 0.4 });
      if (d.type === 'land') audio.sfx('land', { volume: Math.min(0.8, 0.25 + (d.fell ?? 0) * 0.05) });
      if (d.type === 'hurt') audio.sfx('hurt', { volume: 0.8 });
      if (d.type === 'pulse') audio.sfx('bridge', { volume: 0.55, pitch: 1.5 });
    }
    if (type === 'hit') { audio.sfx('hit', { volume: d.heavy ? 0.95 : 0.75, pitch: d.heavy ? 0.85 : 1 }); }
    if (type === 'enemy') {
      const e = d.enemy;
      if (d.type === 'death' && e) at(e.def.boss ? 'shatter' : 'shatter', e.pos, { volume: e.def.boss ? 1.2 : 0.9, range: 18, pitch: e.def.boss ? 0.6 : 1 });
      if (d.type === 'charge' && e) at('enemy_charge', e.pos, { volume: 0.7, range: 14, pitch: e.def.boss ? 0.7 : 1 });
      if (d.type === 'shot' && e) at('enemy_shot', e.pos, { volume: 0.7, range: 16 });
      if (d.type === 'slam' && e) at('land', e.pos, { volume: 1.4, range: 20, pitch: 0.55 });
      if (d.type === 'wake' && e) at('block', e.pos, { volume: 0.4, range: 16, pitch: 0.7 });
    }
    if (type === 'tuned') {
      audio.sfx('spire_tune', { volume: 1 });
      audio.playMusic('triumph', 1.2);
      triumph = 1;
      if (d.spire.id === 'cantor') setTimeout(() => audio.sfx('bridge', { volume: 0.8 }), 1800);
    }
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

    if (triumph) return;
    if (game.state === 'home') audio.playMusic('home');
    else {
      const fighting = game.enemies.list.some((e) => e.alive && e.state !== 'dormant' && e.state !== 'return' && e.pos.distanceTo(p.pos) < 45);
      audio.playMusic(fighting ? 'combat' : 'explore', fighting ? 1.2 : 4);
    }
  };
}

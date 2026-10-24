'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const SCHOOLS = ['Blair', 'Hill', 'Hun', 'Lawrenceville', 'Mercersburg', 'Peddie', 'Pennington'];
const ADMIN_PASSWORD = 'mapl2025';

const FLIGHT_NAMES = ['Singles #1', 'Singles #2', 'Singles #3', 'Doubles #1', 'Doubles #2'];
const IS_DOUBLES = [false, false, false, true, true];

// Match numbering: each flight has 8 matches (M1-M3 R1, M4-M5 SF, M6 Final, M7 C1, M8 C2)
// Flight 0 (S1): matches 1-8
// Flight 1 (S2): matches 9-16
// Flight 2 (S3): matches 17-24
// Flight 3 (D1): matches 25-32
// Flight 4 (D2): matches 33-40
const MATCH_OFFSET = [0, 8, 16, 24, 32];

// Outdoor court assignments per flight
const OUTDOOR_COURTS = [
  ['Ct1E', 'Ct2E', 'Ct3E'],       // Singles #1
  ['Ct1W', 'Ct2W', 'Ct3W'],       // Singles #2
  ['Ct4E', 'Ct5E', 'Ct6E'],       // Singles #3
  ['Center Ct E', 'Center Ct W'], // Doubles #1
  ['Ct5W', 'Ct6W'],               // Doubles #2
];

// Round times outdoor
const ROUND_TIMES = ['9:00 AM', '~10:00 AM', '~12:00 PM'];

// Generate bracket for a flight (7 players, consolation)
// Returns matches array indexed 0-7:
// 0: 4v5, 1: 3v6, 2: 2v7
// 3: 1bye vs W(4v5) [SF1], 4: W(3v6) vs W(2v7) [SF2]
// 5: W(SF1) vs W(SF2) [Final]
// 6: L(M2) vs L(M1) [C1 - consolation play-in], 7: W(C1) vs L(M0) [C2]
function generateBracket(seeds) {
  // seeds is array of 7 objects {name, school} indexed 0-6 (seed 1 = index 0)
  const m = Array(8).fill(null).map(() => ({
    p1: null, p2: null, winner: null, score: null, format: 'proset'
  }));

  // R1
  m[0] = { p1: { ...seeds[3], seed: 4 }, p2: { ...seeds[4], seed: 5 }, winner: null, score: null, format: 'proset' };
  m[1] = { p1: { ...seeds[2], seed: 3 }, p2: { ...seeds[5], seed: 6 }, winner: null, score: null, format: 'proset' };
  m[2] = { p1: { ...seeds[1], seed: 2 }, p2: { ...seeds[6], seed: 7 }, winner: null, score: null, format: 'proset' };

  // Semifinals (best of 3)
  m[3] = { p1: { ...seeds[0], seed: 1, bye: true }, p2: null, winner: null, score: null, format: 'bo3' }; // seed 1 bye vs W(M0)
  m[4] = { p1: null, p2: null, winner: null, score: null, format: 'bo3' }; // W(M1) vs W(M2)

  // Final (best of 3)
  m[5] = { p1: null, p2: null, winner: null, score: null, format: 'bo3' };

  // Consolation
  m[6] = { p1: null, p2: null, winner: null, score: null, format: 'proset' }; // L(M2) vs L(M1)
  m[7] = { p1: null, p2: null, winner: null, score: null, format: 'proset' }; // W(C1) vs L(M0)

  return m;
}

function advanceBracket(matches, changedIdx, indoor) {
  const m = matches.map(x => ({ ...x }));
  const fmt = (f) => indoor ? 'proset' : f;

  // After R1 results, fill SF slots
  // M3: p2 = W(M0)
  if (changedIdx === 0 && m[0].winner) {
    m[3] = { ...m[3], p2: m[0].winner, format: fmt('bo3') };
  }
  // M4: p1 = W(M1), p2 = W(M2)
  if (changedIdx === 1 && m[1].winner) {
    m[4] = { ...m[4], p1: m[1].winner, format: fmt('bo3') };
  }
  if (changedIdx === 2 && m[2].winner) {
    m[4] = { ...m[4], p2: m[2].winner, format: fmt('bo3') };
  }

  // After SF results, fill Final
  if ((changedIdx === 3 || changedIdx === 4)) {
    const sf1w = m[3].winner;
    const sf2w = m[4].winner;
    m[5] = { ...m[5], p1: sf1w || null, p2: sf2w || null, format: fmt('bo3') };
  }

  // Consolation
  // After each R1 result, recompute who gets the bye (highest-seeded loser = lowest seed number)
  // C1 (M6): the two lower-seeded losers play each other
  // C2 (M7): winner of C1 vs the bye (highest-seeded loser)
  if (changedIdx === 0 || changedIdx === 1 || changedIdx === 2) {
    const losers = [m[0].loser, m[1].loser, m[2].loser].filter(Boolean);
    if (losers.length > 0) {
      // Sort by seed ascending — lowest seed number = best seed = gets the bye
      losers.sort((a, b) => a.seed - b.seed);
      if (losers.length === 3) {
        // All 3 R1 results in: bye goes to best seed, other two play C1
        const byePlayer = losers[0];
        const c1players = losers.slice(1); // the two worse seeds
        m[6] = { ...m[6], p1: c1players[0], p2: c1players[1] };
        m[7] = { ...m[7], p2: byePlayer };
      } else if (losers.length === 2) {
        // 2 results in: tentatively assign C1, bye TBD
        const byePlayer = losers[0];
        const c1player = losers[1];
        m[6] = { ...m[6], p1: c1player, p2: null };
        m[7] = { ...m[7], p2: byePlayer };
      } else {
        // 1 result in: just track, nothing to assign yet
        m[6] = { ...m[6], p1: losers[0], p2: null };
        m[7] = { ...m[7], p2: null };
      }
    }
  }
  if (changedIdx === 6 && m[6].winner) {
    m[7] = { ...m[7], p1: m[6].winner };
  }

  return m;
}

function pointsForFlight(matches) {
  // Scoring: seed1 bye = 1pt, every win = 1pt, consolation win = 0.5pt
  const pts = {};
  if (!matches) return pts;

  const add = (player, val) => {
    if (!player) return;
    const key = player.name;
    pts[key] = (pts[key] || { school: player.school, pts: 0 });
    pts[key].pts += val;
  };

  // Seed 1 bye = 1 pt
  if (matches[3]?.p1?.bye) add(matches[3].p1, 1);

  // Winners bracket wins = 1 pt each
  for (let i = 0; i <= 5; i++) {
    if (matches[i]?.winner) add(matches[i].winner, 1);
  }

  // Consolation bye = 0.5 pt: highest-seeded loser sits out C1, goes straight to C2 as p2
  if (matches[7]?.p2) add(matches[7].p2, 0.5);

  // Consolation wins = 0.5 pt each
  for (let i = 6; i <= 7; i++) {
    if (matches[i]?.winner) add(matches[i].winner, 0.5);
  }

  return pts;
}

// Aggregate team points across all flights
function teamPoints(flights) {
  const totals = {};
  SCHOOLS.forEach(s => { totals[s] = 0; });
  flights.forEach(flight => {
    if (!flight?.matches) return;
    const fp = pointsForFlight(flight.matches);
    Object.values(fp).forEach(({ school, pts }) => {
      if (school && totals[school] !== undefined) totals[school] += pts;
    });
  });
  return totals;
}

// ---- Score input modal ----
function ScoreModal({ match, matchLabel, onSave, onClose, indoor }) {
  const [winner, setWinner] = useState(match.winner?.name || '');
  const [score, setScore] = useState(match.score || '');
  const isProset = indoor || match.format === 'proset';
  const isBo3 = !indoor && match.format === 'bo3';

  const p1 = match.p1;
  const p2 = match.p2;
  if (!p1 || !p2) return null;

  const handleSave = () => {
    if (!winner || !score) return;
    const winnerObj = winner === p1.name ? p1 : p2;
    const loserObj = winner === p1.name ? p2 : p1;
    onSave({ winner: winnerObj, loser: loserObj, score });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, color: '#222' }}>{matchLabel}</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 6 }}>WINNER</div>
          {[p1, p2].map(p => (
            <label key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
              <input type="radio" name="winner" value={p.name} checked={winner === p.name} onChange={() => setWinner(p.name)} />
              <span>{p.name} <span style={{ color: '#888', fontSize: 13 }}>({p.school})</span></span>
            </label>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 6 }}>
            SCORE {isProset ? '(e.g. 8–3)' : '(e.g. 6–3, 4–6, 10–7)'}
          </div>
          <input
            value={score}
            onChange={e => setScore(e.target.value)}
            placeholder={isProset ? '8–3' : '6–3, 4–6, 10–7'}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', background: 'white' }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', background: '#c26b3f', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ---- Flight bracket view ----
function FlightView({ flightIdx, flight, isAdmin, onUpdate, indoor }) {
  const [modal, setModal] = useState(null); // { matchIdx }

  const matches = flight?.matches;
  if (!matches) return <div style={{ color: '#888', padding: 24 }}>No bracket generated yet.</div>;

  const matchNum = (localIdx) => MATCH_OFFSET[flightIdx] + localIdx + 1;
  const flightName = FLIGHT_NAMES[flightIdx];

  const handleEdit = (matchIdx) => {
    const m = matches[matchIdx];
    if (!m.p1 || !m.p2) return;
    setModal({ matchIdx });
  };

  const handleSave = (matchIdx, result) => {
    const newMatches = matches.map((m, i) => i === matchIdx ? { ...m, ...result } : m);
    const advanced = advanceBracket(newMatches, matchIdx, indoor);
    onUpdate({ ...flight, matches: advanced });
    setModal(null);
  };

  const matchCard = (matchIdx, label, round) => {
    const m = matches[matchIdx];
    const mNum = matchNum(matchIdx);
    const isConsolation = matchIdx >= 6;
    const canEdit = isAdmin && m.p1 && m.p2;
    const fmt = indoor ? 'PROSET' : (m.format === 'bo3' ? 'Best of 3' : 'PROSET');

    return (
      <div key={matchIdx} style={{ background: 'white', border: '1px solid #e8e0d8', borderRadius: 10, padding: '12px 14px', marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1 }}>MATCH {mNum}</span>
            <span style={{ fontSize: 10, background: isConsolation ? '#f0f0f0' : '#e8f4e8', color: isConsolation ? '#666' : '#3a7a3a', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>{fmt}</span>
          </div>
          {canEdit && (
            <button onClick={() => handleEdit(matchIdx)} style={{ fontSize: 11, padding: '3px 10px', border: '1px solid #ddd', borderRadius: 5, cursor: 'pointer', background: 'white', color: '#555' }}>
              {m.winner ? 'Edit' : 'Enter'}
            </button>
          )}
        </div>
        <PlayerRow player={m.p1} isWinner={m.winner?.name === m.p1?.name} score={m.winner ? m.score : null} showScore={m.winner?.name === m.p1?.name} />
        <div style={{ height: 4 }} />
        <PlayerRow player={m.p2} isWinner={m.winner?.name === m.p2?.name} score={m.winner ? m.score : null} showScore={m.winner?.name === m.p2?.name} />
      </div>
    );
  };

  const PlayerRow = ({ player, isWinner, score, showScore }) => {
    if (!player) return (
      <div style={{ padding: '6px 8px', borderRadius: 6, background: '#f5f5f5', color: '#bbb', fontSize: 13, fontStyle: 'italic' }}>TBD</div>
    );
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: isWinner ? '#f0f7f0' : 'transparent' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: isWinner ? '#3a7a3a' : '#e8e0d8', color: isWinner ? 'white' : '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
          {player.seed}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: isWinner ? 700 : 400, fontSize: 14, color: isWinner ? '#1a4a1a' : '#333' }}>{player.name}</div>
          <div style={{ fontSize: 11, color: '#888' }}>{player.school}</div>
        </div>
        {showScore && score && <div style={{ fontSize: 13, fontWeight: 600, color: '#3a7a3a' }}>{score}</div>}
        {player.bye && !isWinner && <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>BYE (+1 pt)</div>}
      </div>
    );
  };

  // Points for this flight
  const fp = pointsForFlight(matches);
  const sorted = Object.entries(fp).sort((a, b) => b[1].pts - a[1].pts);

  return (
    <div>
      {modal && (
        <ScoreModal
          match={matches[modal.matchIdx]}
          matchLabel={`Match ${matchNum(modal.matchIdx)} — ${flightName}`}
          onSave={(result) => handleSave(modal.matchIdx, result)}
          onClose={() => setModal(null)}
          indoor={indoor}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* R1 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 8 }}>ROUND 1</div>
          {matchCard(0, '4v5', 1)}
          {matchCard(1, '3v6', 1)}
          {matchCard(2, '2v7', 1)}
        </div>

        {/* Semis */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 8 }}>SEMIFINALS</div>
          {matchCard(3, 'SF1', 2)}
          {matchCard(4, 'SF2', 2)}
        </div>

        {/* Final */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 8 }}>FINAL</div>
          {matchCard(5, 'Final', 3)}
        </div>
      </div>

      {/* Consolation bracket */}
      <div style={{ borderTop: '2px solid #e8e0d8', paddingTop: 16, marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#c26b3f', marginBottom: 12 }}>Consolation bracket</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 8 }}>ROUND 1 (0.5 pt)</div>
            {matchCard(6, 'C1', 2)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 8 }}>ROUND 2 (0.5 pt)</div>
            {matchCard(7, 'C2', 3)}
          </div>
        </div>
      </div>

      {/* Flight points */}
      {sorted.length > 0 && (
        <div style={{ background: '#fafaf8', border: '1px solid #e8e0d8', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 10 }}>FLIGHT POINTS</div>
          {sorted.map(([name, { school, pts }]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f0ece6' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 6 }}>{school}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#c26b3f' }}>{pts}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Setup tab ----
function SetupTab({ flights, onGenerate, isAdmin }) {
  const [seeds, setSeeds] = useState(() =>
    FLIGHT_NAMES.map((_, fi) =>
      Array(7).fill(null).map(() => IS_DOUBLES[fi] ? { name1: '', name2: '', school: '' } : { name: '', school: '' })
    )
  );

  useEffect(() => {
    if (flights && flights.some(f => f?.seeds)) {
      setSeeds(FLIGHT_NAMES.map((_, fi) => {
        if (flights[fi]?.seeds) return flights[fi].seeds;
        return Array(7).fill(null).map(() => IS_DOUBLES[fi] ? { name1: '', name2: '', school: '' } : { name: '', school: '' });
      }));
    }
  }, []);

  const update = (fi, si, field, val) => {
    setSeeds(prev => prev.map((f, i) => i === fi ? f.map((s, j) => j === si ? { ...s, [field]: val } : s) : f));
  };

  const handleGenerate = () => {
    if (!isAdmin) return;
    onGenerate(seeds);
  };

  const allFilled = seeds.every((flight, fi) => flight.every(s =>
    IS_DOUBLES[fi] ? (s.name1 && s.name2 && s.school) : (s.name && s.school)
  ));

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#222', marginBottom: 4 }}>Assign seeds for each flight</h2>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>Singles: player name + school. Doubles: two player names + school.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, marginBottom: 28 }}>
        {FLIGHT_NAMES.map((fname, fi) => (
          <div key={fi} style={{ background: 'white', border: '1px solid #e8e0d8', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{fname}</div>
              <div style={{ fontSize: 11, background: '#f5ece6', color: '#c26b3f', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
                {MATCH_OFFSET[fi] + 1}–{MATCH_OFFSET[fi] + 8}
              </div>
            </div>
            {seeds[fi].map((seed, si) => (
              <div key={si} style={{ marginBottom: 12, padding: 10, background: '#fafaf8', borderRadius: 8, border: '1px solid #f0ece6' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#c26b3f', marginBottom: 6 }}>SEED {si + 1}</div>
                {IS_DOUBLES[fi] ? (
                  <>
                    <input
                      value={seed.name1}
                      onChange={e => update(fi, si, 'name1', e.target.value)}
                      placeholder="Player 1 name"
                      disabled={!isAdmin}
                      style={{ width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, marginBottom: 4, boxSizing: 'border-box' }}
                    />
                    <input
                      value={seed.name2}
                      onChange={e => update(fi, si, 'name2', e.target.value)}
                      placeholder="Player 2 name"
                      disabled={!isAdmin}
                      style={{ width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, marginBottom: 4, boxSizing: 'border-box' }}
                    />
                  </>
                ) : (
                  <input
                    value={seed.name}
                    onChange={e => update(fi, si, 'name', e.target.value)}
                    placeholder="Player name"
                    disabled={!isAdmin}
                    style={{ width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, marginBottom: 4, boxSizing: 'border-box' }}
                  />
                )}
                <select
                  value={seed.school}
                  onChange={e => update(fi, si, 'school', e.target.value)}
                  disabled={!isAdmin}
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid #ddd', borderRadius: 5, fontSize: 13, boxSizing: 'border-box' }}
                >
                  <option value="">— select school —</option>
                  {SCHOOLS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>

      {isAdmin && (
        <button
          onClick={handleGenerate}
          disabled={!allFilled}
          style={{ padding: '12px 32px', background: allFilled ? '#c26b3f' : '#ccc', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: allFilled ? 'pointer' : 'not-allowed' }}
        >
          Generate Brackets
        </button>
      )}
    </div>
  );
}

// ---- Order of Play tab ----
function OOPTab({ flights, generated, indoor }) {
  if (!generated || !flights.some(f => f)) {
    return <div style={{ color: '#888', padding: 24 }}>Generate brackets first to see the order of play.</div>;
  }

  const allMatches = [];
  flights.forEach((flight, fi) => {
    if (!flight?.matches) return;
    flight.matches.forEach((m, mi) => {
      if (!m.p1 || !m.p2) return;
      // Determine round
      let round, roundTime;
      if (mi <= 2) { round = 1; roundTime = ROUND_TIMES[0]; }
      else if (mi <= 4 || mi === 6) { round = 2; roundTime = ROUND_TIMES[1]; }
      else { round = 3; roundTime = ROUND_TIMES[2]; }

      const mNum = MATCH_OFFSET[fi] + mi + 1;
      allMatches.push({ fi, mi, mNum, round, roundTime, match: m, flightName: FLIGHT_NAMES[fi] });
    });
  });

  if (indoor) {
    // Indoor: single queue, 4 courts, all prosets
    // Group by round
    const rounds = [1, 2, 3];
    return (
      <div>
        <div style={{ background: '#1a3a5c', color: 'white', borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 13 }}>
          🏠 Indoor mode — all prosets, no-ad, 4 courts shared rotation
        </div>
        {rounds.map(r => {
          const rMatches = allMatches.filter(x => x.round === r);
          if (!rMatches.length) return null;
          return (
            <div key={r} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Round {r}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{ROUND_TIMES[r-1]}</div>
              </div>
              {rMatches.map(({ mNum, flightName, match }) => (
                <div key={mNum} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'white', border: '1px solid #e8e0d8', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#888', width: 30 }}>{mNum}</div>
                  <div style={{ fontSize: 11, background: '#e8f4e8', color: '#3a7a3a', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{flightName}</div>
                  <div style={{ flex: 1, fontSize: 14 }}>{match.p1.name} vs {match.p2.name}</div>
                  {match.winner && <div style={{ fontSize: 12, color: '#3a7a3a', fontWeight: 600 }}>✓ {match.score}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // Outdoor: group by flight, show courts
  return (
    <div>
      {[1, 2, 3].map(r => {
        const rMatches = allMatches.filter(x => x.round === r);
        if (!rMatches.length) return null;
        return (
          <div key={r} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Round {r}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{ROUND_TIMES[r-1]}</div>
            </div>

            {FLIGHT_NAMES.map((fname, fi) => {
              const fMatches = rMatches.filter(x => x.fi === fi);
              if (!fMatches.length) return null;
              const courts = OUTDOOR_COURTS[fi];
              return (
                <div key={fi} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#c26b3f', marginBottom: 6, letterSpacing: 0.5 }}>{fname}</div>
                  {fMatches.map(({ mNum, match }, idx) => (
                    <div key={mNum} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'white', border: '1px solid #e8e0d8', borderRadius: 8, padding: '9px 13px', marginBottom: 5 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', width: 30 }}>{mNum}</div>
                      {courts[idx] && <div style={{ fontSize: 11, background: '#f5ece6', color: '#c26b3f', borderRadius: 4, padding: '2px 7px', fontWeight: 600, minWidth: 60, textAlign: 'center' }}>{courts[idx]}</div>}
                      <div style={{ flex: 1, fontSize: 14 }}>{match.p1.name} vs {match.p2.name}</div>
                      {match.winner && <div style={{ fontSize: 12, color: '#3a7a3a', fontWeight: 600 }}>✓ {match.score}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---- Team Scores tab ----
function TeamScoresTab({ flights }) {
  const totals = teamPoints(flights);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const maxPts = sorted[0]?.[1] || 1;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#222', marginBottom: 20 }}>Team Standings</h2>
      {sorted.map(([school, pts], i) => (
        <div key={school} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: i === 0 ? '#c26b3f' : '#e8e0d8', color: i === 0 ? 'white' : '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
            {i + 1}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{school}</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#c26b3f' }}>{pts}</span>
            </div>
            <div style={{ height: 6, background: '#f0ece6', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(pts / maxPts) * 100}%`, background: i === 0 ? '#c26b3f' : '#a0b8a0', borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>
      ))}

      {/* Per-flight breakdown */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#888', marginBottom: 14, letterSpacing: 0.5 }}>POINTS BY FLIGHT</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafaf8' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', border: '1px solid #e8e0d8', fontWeight: 700 }}>School</th>
                {FLIGHT_NAMES.map(f => <th key={f} style={{ padding: '8px 10px', border: '1px solid #e8e0d8', fontWeight: 700, textAlign: 'center' }}>{f}</th>)}
                <th style={{ padding: '8px 10px', border: '1px solid #e8e0d8', fontWeight: 700, textAlign: 'center', color: '#c26b3f' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([school, total]) => {
                const row = FLIGHT_NAMES.map((_, fi) => {
                  if (!flights[fi]?.matches) return 0;
                  const fp = pointsForFlight(flights[fi].matches);
                  return Object.values(fp).filter(x => x.school === school).reduce((s, x) => s + x.pts, 0);
                });
                return (
                  <tr key={school}>
                    <td style={{ padding: '7px 10px', border: '1px solid #e8e0d8', fontWeight: 600 }}>{school}</td>
                    {row.map((p, i) => <td key={i} style={{ padding: '7px 10px', border: '1px solid #e8e0d8', textAlign: 'center' }}>{p || '—'}</td>)}
                    <td style={{ padding: '7px 10px', border: '1px solid #e8e0d8', textAlign: 'center', fontWeight: 700, color: '#c26b3f' }}>{total || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Main App ----
export default function App() {
  const [flights, setFlights] = useState([null, null, null, null, null]);
  const [generated, setGenerated] = useState(false);
  const [indoor, setIndoor] = useState(false);
  const [activeTab, setActiveTab] = useState('setup');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);

  const isSavingRef = useRef(false);
  const saveQueueRef = useRef(Promise.resolve());
  const pendingSaveRef = useRef(null);

  // Load from Supabase
  useEffect(() => {
    supabase.from('tournament_state').select('state').eq('id', 1).single().then(({ data }) => {
      if (data?.state) {
        setFlights(data.state.flights || [null, null, null, null, null]);
        setGenerated(data.state.generated || false);
        setIndoor(data.state.indoor || false);
      }
    });

    const channel = supabase.channel('tournament').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournament_state' }, ({ new: row }) => {
      if (!isSavingRef.current && row.state) {
        setFlights(row.state.flights || [null, null, null, null, null]);
        setGenerated(row.state.generated || false);
        setIndoor(row.state.indoor || false);
      }
    }).subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const saveToSupabase = useCallback((newFlights, newGenerated, newIndoor) => {
    const stateToSave = { flights: newFlights, generated: newGenerated, indoor: newIndoor };
    pendingSaveRef.current = stateToSave;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (!pendingSaveRef.current) return;
      const s = pendingSaveRef.current;
      pendingSaveRef.current = null;
      isSavingRef.current = true;
      await supabase.from('tournament_state').update({ state: s }).eq('id', 1);
      setTimeout(() => { isSavingRef.current = false; }, 2000);
    });
  }, []);

  const handleGenerate = (seeds) => {
    const newFlights = seeds.map((seedList, fi) => {
      // For doubles, combine name1+name2 as display name
      const players = seedList.map((s, si) => {
        if (IS_DOUBLES[fi]) {
          return { name: `${s.name1} / ${s.name2}`, school: s.school, seed: si + 1 };
        }
        return { name: s.name, school: s.school, seed: si + 1 };
      });
      return { seeds: seedList, players, matches: generateBracket(players) };
    });
    setFlights(newFlights);
    setGenerated(true);
    setActiveTab('oop');
    saveToSupabase(newFlights, true, indoor);
  };

  const handleFlightUpdate = (fi, updatedFlight) => {
    setFlights(prev => {
      const next = prev.map((f, i) => i === fi ? updatedFlight : f);
      saveToSupabase(next, generated, indoor);
      return next;
    });
  };

  const handleIndoorToggle = () => {
    const newIndoor = !indoor;
    setIndoor(newIndoor);
    saveToSupabase(flights, generated, newIndoor);
  };

  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) {
      setIsAdmin(true);
      setShowLogin(false);
      setPwInput('');
      setPwError(false);
    } else {
      setPwError(true);
    }
  };

  const TABS = [
    { id: 'setup', label: 'Setup' },
    { id: 'oop', label: 'Order of Play' },
    ...FLIGHT_NAMES.map((f, i) => ({ id: `flight${i}`, label: f })),
    { id: 'scores', label: 'Team Scores' },
  ];

  const accentColor = indoor ? '#1a3a5c' : '#c26b3f';

  return (
    <div style={{ minHeight: '100vh', background: '#f5f0ea' }}>
      {/* Header */}
      <div style={{ background: indoor ? '#1a3a5c' : '#3a2a1a', color: 'white', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 24 }}>🎾</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.5 }}>MAPL Girls Tennis</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>MID-ATLANTIC PREP LEAGUE</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isAdmin && (
            <button onClick={handleIndoorToggle} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {indoor ? '☀️ Move outside' : '🏠 Go indoor'}
            </button>
          )}
          {isAdmin ? (
            <div style={{ fontSize: 12, background: 'rgba(255,255,255,0.15)', padding: '4px 10px', borderRadius: 5 }}>Admin</div>
          ) : (
            <button onClick={() => setShowLogin(true)} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              Admin Login
            </button>
          )}
        </div>
      </div>

      {/* Accent bar */}
      <div style={{ height: 3, background: accentColor }} />

      {/* Nav tabs */}
      <div style={{ background: 'white', borderBottom: '1px solid #e8e0d8', overflowX: 'auto' }}>
        <div style={{ display: 'flex', minWidth: 'max-content' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '12px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? accentColor : '#666',
              borderBottom: activeTab === tab.id ? `2px solid ${accentColor}` : '2px solid transparent',
              whiteSpace: 'nowrap'
            }}>{tab.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        {activeTab === 'setup' && <SetupTab flights={flights} onGenerate={handleGenerate} isAdmin={isAdmin} />}
        {activeTab === 'oop' && <OOPTab flights={flights} generated={generated} indoor={indoor} />}
        {FLIGHT_NAMES.map((_, fi) => activeTab === `flight${fi}` && (
          <FlightView key={fi} flightIdx={fi} flight={flights[fi]} isAdmin={isAdmin} onUpdate={(f) => handleFlightUpdate(fi, f)} indoor={indoor} />
        ))}
        {activeTab === 'scores' && <TeamScoresTab flights={flights} />}
      </div>

      {/* Login modal */}
      {showLogin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 28, width: 300 }}>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>Admin Login</div>
            <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Password" style={{ width: '100%', padding: '8px 10px', border: `1px solid ${pwError ? '#e55' : '#ddd'}`, borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
            {pwError && <div style={{ color: '#e55', fontSize: 13, marginBottom: 8 }}>Incorrect password</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowLogin(false); setPwInput(''); setPwError(false); }} style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', background: 'white' }}>Cancel</button>
              <button onClick={handleLogin} style={{ padding: '8px 16px', background: '#c26b3f', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Login</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

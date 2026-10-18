// NFL teams: ESPN logo code and primary color, matched by nickname so any
// option that names a team ("Bears", "Chicago Bears") gets its logo.
const NFL = {
  cardinals: ['ari', '#97233f'], falcons: ['atl', '#a71930'], ravens: ['bal', '#241773'], bills: ['buf', '#00338d'],
  panthers: ['car', '#0085ca'], bears: ['chi', '#0b162a'], bengals: ['cin', '#fb4f14'], browns: ['cle', '#311d00'],
  cowboys: ['dal', '#041e42'], broncos: ['den', '#fb4f14'], lions: ['det', '#0076b6'], packers: ['gb', '#203731'],
  texans: ['hou', '#03202f'], colts: ['ind', '#002c5f'], jaguars: ['jax', '#006778'], chiefs: ['kc', '#e31837'],
  raiders: ['lv', '#000000'], chargers: ['lac', '#0080c6'], rams: ['lar', '#003594'], dolphins: ['mia', '#008e97'],
  vikings: ['min', '#4f2683'], patriots: ['ne', '#002244'], saints: ['no', '#d3bc8d'], giants: ['nyg', '#0b2265'],
  jets: ['nyj', '#125740'], eagles: ['phi', '#004c54'], steelers: ['pit', '#ffb612'], '49ers': ['sf', '#aa0000'],
  seahawks: ['sea', '#002244'], buccaneers: ['tb', '#d50a0a'], titans: ['ten', '#0c2340'], commanders: ['wsh', '#5a1414'],
};

export function findTeam(name) {
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/);
  for (const w of words) {
    if (NFL[w]) {
      const [code, color] = NFL[w];
      return { code, color, logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png` };
    }
  }
  return null;
}

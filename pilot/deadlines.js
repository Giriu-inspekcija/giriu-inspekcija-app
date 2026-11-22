/* All task deadlines are entered and displayed in the organisation's civil time. */
(() => {
  const zone = 'Europe/Vilnius';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const displayFormat = new Intl.DateTimeFormat('lt-LT', {
    timeZone: zone, dateStyle: 'medium', timeStyle: 'short'
  });
  function inputValue(instant) {
    const p = Object.fromEntries(parts.formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;
  }
  function toInstant(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw Error('Pasirinkite datą ir laiką.');
    const nominal = Date.parse(value + ':00Z');
    if (!Number.isFinite(nominal)) throw Error('Neteisinga data.');
    // Sample local offsets on both sides of a possible clock change.
    const offsets = new Set([-86400000, 86400000].map(delta => {
      const sample = nominal + delta;
      return Date.parse(inputValue(sample) + ':00Z') - sample;
    }));
    const candidates = [...offsets].map(offset => nominal - offset)
      .filter(time => inputValue(time) === value);
    if (candidates.length !== 1) throw Error(candidates.length
      ? 'Šis laikas Vilniuje kartojasi. Pasirinkite laiką už laikrodžio keitimo valandos ribų.'
      : 'Tokios datos arba valandos Vilniuje nėra. Pasirinkite kitą laiką.');
    return new Date(candidates[0]).toISOString();
  }
  const api = {inputValue, toInstant, display: instant => displayFormat.format(new Date(instant))};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.giDeadlines = api;
})();

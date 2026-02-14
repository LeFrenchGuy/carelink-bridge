let verbose = false;
let timezone: string | undefined;

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function setTimezone(tz: string | undefined): void {
  timezone = tz;
}

function formatTimestamp(): string {
  const now = new Date();
  
  // Use configured timezone or system default
  return now.toLocaleString('en-US', {
    timeZone: timezone || undefined,  // undefined = use system timezone
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+):(\d+)/, '$3-$1-$2 $4:$5:$6');
}

export function log(...args: unknown[]): void {
  if (verbose) {
    console.log(formatTimestamp(), ...args);
  }
}

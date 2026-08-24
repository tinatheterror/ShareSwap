with open('components/CounterProposalSheet.tsx', 'r') as f:
    content = f.read()

old = '''function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}'''

new = '''function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const datePart = s.split("T")[0];
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(datePart);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const day = Number(match[3]);
    const d = new Date(y, m - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}'''

if old in content:
    content = content.replace(old, new)
    with open('components/CounterProposalSheet.tsx', 'w') as f:
        f.write(content)
    print("SUCCESS")
else:
    print("NOT FOUND")

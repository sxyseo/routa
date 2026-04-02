import { redirect } from "next/navigation";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

function normalizeSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function HarnessConsoleRedirectPage({ searchParams }: { searchParams: SearchParams }) {
  const query = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(searchParams)) {
    const value = normalizeSearchParam(rawValue);
    if (value) {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  redirect(suffix ? `/settings/harness?${suffix}` : "/settings/harness");
}

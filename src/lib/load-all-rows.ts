type PageResult<T> = {
  data: T[] | null;
  error: unknown;
};

/** Read through the server's row cap, publishing results only after every page succeeds. */
export async function loadAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await fetchPage(
      rows.length,
      rows.length + pageSize - 1,
    );
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

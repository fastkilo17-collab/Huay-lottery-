-- ตารางผลย้อนหลังจากเว็บภายนอก (ใช้กับแท็บ "ย้อนหลังจากเว็บ") — รันแล้วใน HanoiLotteryStats
create table if not exists public.lotto_backward (
  id bigint generated always as identity primary key,
  slug text not null check (slug ~ '^[a-z0-9_-]{1,60}$'),
  name text not null,
  draw_date date not null,
  vals jsonb not null default '{}'::jsonb,
  source text not null default 'exphuay',
  created_at timestamptz not null default now(),
  unique (slug, draw_date)
);
create index if not exists lotto_backward_slug_date_idx on public.lotto_backward (slug, draw_date desc);
alter table public.lotto_backward enable row level security;
create policy lotto_backward_read on public.lotto_backward for select to anon, authenticated using (true);

create or replace function public.import_backward(p_slug text, p_name text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_slug !~ '^[a-z0-9_-]{1,60}$' then raise exception 'invalid slug'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'invalid rows'; end if;
  insert into public.lotto_backward(slug, name, draw_date, vals)
  select p_slug, left(p_name, 120), (x->>'date')::date, coalesce(x->'vals', '{}'::jsonb)
  from jsonb_array_elements(p_rows) x
  on conflict (slug, draw_date) do update set vals = excluded.vals, name = excluded.name;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.import_backward(text,text,jsonb) from public;
grant execute on function public.import_backward(text,text,jsonb) to anon, authenticated;

-- รันใน Supabase → SQL Editor (เปิดใช้งานโดยไม่ต้องล็อกอิน: อ่านและเพิ่มได้ ลบ/แก้ตรงๆ ไม่ได้)
drop view if exists public.v_last2;
drop policy if exists draws_owner on public.draws;
drop policy if exists results_owner on public.results;
drop function if exists public.save_draw(text,text,int,text,jsonb);

alter table public.draws drop constraint if exists draws_user_id_draw_no_key;
alter table public.draws drop column if exists user_id;
alter table public.results drop column if exists user_id;
drop index if exists draws_user_no_idx;
alter table public.draws add constraint draws_draw_no_key unique (draw_no);

create policy draws_read on public.draws for select to anon, authenticated using (true);
create policy draws_add on public.draws for insert to anon, authenticated with check (true);
create policy results_read on public.results for select to anon, authenticated using (true);
create policy results_add on public.results for insert to anon, authenticated with check (true);

create view public.v_last2 with (security_invoker = true) as
select r.draw_id, d.draw_no, r.tier, r.position, r.number, right(r.number, 2) as last2
from public.results r join public.draws d on d.id = r.draw_id;
grant select on public.v_last2 to anon, authenticated;

create or replace function public.save_draw(
  p_draw_no text, p_game text, p_interval_sec int, p_source text, p_results jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_draw_no !~ '^[0-9]{10}$' then raise exception 'invalid draw_no'; end if;
  insert into public.draws(draw_no, game, interval_sec, source)
  values (p_draw_no, coalesce(p_game,'ฮานอย 27'), coalesce(p_interval_sec,90), coalesce(p_source,'image'))
  on conflict (draw_no) do update
    set game = excluded.game, interval_sec = excluded.interval_sec, source = excluded.source
  returning id into v_id;
  delete from public.results where draw_id = v_id;
  insert into public.results(draw_id, tier, position, number)
  select v_id, x->>'tier', (x->>'position')::int, x->>'number'
  from jsonb_array_elements(p_results) x;
  return v_id;
end $$;
revoke all on function public.save_draw(text,text,int,text,jsonb) from public;
grant execute on function public.save_draw(text,text,int,text,jsonb) to anon, authenticated;

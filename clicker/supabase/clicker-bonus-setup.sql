drop function if exists public.register_click(text);
drop function if exists public.get_clicker_state(text);
drop table if exists public.clicker_player_state;
drop table if exists public.clicker_family_state;

create table if not exists public.clicker_game_settings (
    id boolean primary key default true check (id),
    bonus_min_clicks integer not null default 30 check (bonus_min_clicks > 0),
    bonus_max_clicks integer not null default 60 check (bonus_max_clicks >= bonus_min_clicks),
    family_coefficient_per_player numeric(6, 3) not null default 1.1
);

alter table public.clicker_game_settings
    add column if not exists family_coefficient_per_player numeric(6, 3) not null default 1.1;

alter table public.clicker_game_settings
    drop column if exists bonus_duration_seconds,
    drop column if exists bonus_multiplier_min,
    drop column if exists bonus_multiplier_max,
    drop column if exists family_clicks_per_step,
    drop column if exists family_coefficient_start,
    drop column if exists family_coefficient_increment,
    drop column if exists family_coefficient_max;

insert into public.clicker_game_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.clicker_game_settings enable row level security;

drop policy if exists "Anyone can read clicker settings"
on public.clicker_game_settings;

create policy "Anyone can read clicker settings"
on public.clicker_game_settings
for select
to anon, authenticated
using (true);

grant select on public.clicker_game_settings to anon, authenticated;

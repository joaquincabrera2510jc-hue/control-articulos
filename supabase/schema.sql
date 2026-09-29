-- =====================================================================
--  Control de Artículos — esquema de base de datos para Supabase
--  Pegar completo en Supabase > SQL Editor > New query > Run.
--  Se puede volver a ejecutar sin perder datos (usa IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- ---------- Tablas ----------------------------------------------------

create table if not exists public.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  usuario        text not null unique check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  nombre         text not null check (length(trim(nombre)) > 0),
  rol            text not null check (rol in ('admin','operador','taller','lectura')),
  activo         boolean not null default true,
  creado         timestamptz not null default now(),
  ultimo_ingreso timestamptz
);

create table if not exists public.articulos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null default '',
  nombre      text not null check (length(trim(nombre)) > 0),
  marca       text not null default '',
  veh_marca   text not null default '',
  veh_modelo  text not null default '',
  categoria   text not null default 'Otros',
  ubicacion   text not null default '',
  stock       integer not null default 0 check (stock >= 0),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index if not exists articulos_codigo_unico
  on public.articulos (lower(codigo)) where codigo <> '';

create table if not exists public.movimientos (
  id            uuid primary key default gen_random_uuid(),
  articulo_id   uuid not null references public.articulos(id) on delete cascade,
  tipo          text not null check (tipo in ('entrada','salida','ajuste','anulacion')),
  cantidad      integer not null check (cantidad >= 0),
  antes         integer not null,
  despues       integer not null,
  motivo        text not null default '',
  pedido        text,
  por           uuid references public.perfiles(id),
  fecha         timestamptz not null default now(),
  anulado_por   uuid references public.perfiles(id),
  anulado_fecha timestamptz,
  anula         uuid references public.movimientos(id)
);
create index if not exists movimientos_fecha on public.movimientos (fecha desc);
create index if not exists movimientos_articulo on public.movimientos (articulo_id, fecha desc);

create sequence if not exists public.pedidos_cliente_seq;
create sequence if not exists public.pedidos_proveedor_seq;

create table if not exists public.pedidos (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null unique,
  tipo              text not null check (tipo in ('cliente','proveedor')),
  contacto          text not null check (length(trim(contacto)) > 0),
  telefono          text not null default '',
  fecha_estimada    date,
  estado            text not null,
  notas             text not null default '',
  items             jsonb not null default '[]'::jsonb,
  stock_aplicado    boolean not null default false,
  historial_estados jsonb not null default '[]'::jsonb,
  creado            timestamptz not null default now(),
  creado_por        uuid references public.perfiles(id),
  actualizado       timestamptz not null default now()
);

-- ---------- Ayudantes ---------------------------------------------------

-- Rol del usuario conectado (null si no tiene perfil o está desactivado)
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

create or replace function public.estados_pedido(p_tipo text) returns text[]
language sql immutable as $$
  select case p_tipo
    when 'cliente'   then array['Pendiente','En preparación','Listo para retirar','Entregado','Cancelado']
    when 'proveedor' then array['Solicitado','Confirmado','En camino','Recibido','Cancelado']
  end
$$;

create or replace function public.estado_final(p_tipo text) returns text
language sql immutable as $$
  select case p_tipo when 'cliente' then 'Entregado' else 'Recibido' end
$$;

-- Número, estado inicial y autor de cada pedido nuevo
create or replace function public.pedidos_antes_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'cliente' then
    new.numero := 'C-' || lpad(nextval('public.pedidos_cliente_seq')::text, 4, '0');
  else
    new.numero := 'P-' || lpad(nextval('public.pedidos_proveedor_seq')::text, 4, '0');
  end if;
  new.estado := (public.estados_pedido(new.tipo))[1];
  new.stock_aplicado := false;
  new.historial_estados := jsonb_build_array(jsonb_build_object('estado', new.estado, 'fecha', now(), 'por', auth.uid()));
  new.creado := now();
  new.creado_por := auth.uid();
  new.actualizado := now();
  return new;
end $$;
drop trigger if exists pedidos_antes_insertar on public.pedidos;
create trigger pedidos_antes_insertar before insert on public.pedidos
  for each row execute function public.pedidos_antes_insertar();

-- Un pedido cerrado no cambia sus artículos
create or replace function public.pedidos_antes_actualizar() returns trigger
language plpgsql as $$
begin
  if old.stock_aplicado and new.items is distinct from old.items then
    raise exception 'El pedido ya movió stock: no se pueden cambiar sus artículos.';
  end if;
  new.actualizado := now();
  return new;
end $$;
drop trigger if exists pedidos_antes_actualizar on public.pedidos;
create trigger pedidos_antes_actualizar before update on public.pedidos
  for each row execute function public.pedidos_antes_actualizar();

create or replace function public.articulos_antes_actualizar() returns trigger
language plpgsql as $$
begin new.actualizado := now(); return new; end $$;
drop trigger if exists articulos_antes_actualizar on public.articulos;
create trigger articulos_antes_actualizar before update on public.articulos
  for each row execute function public.articulos_antes_actualizar();

-- ---------- Operaciones (se ejecutan en el servidor, de forma atómica) ----

-- Al ingresar: registra la hora y devuelve el perfil (null si no puede entrar)
create or replace function public.registrar_ingreso() returns public.perfiles
language plpgsql security definer set search_path = public as $$
declare r public.perfiles;
begin
  update public.perfiles set ultimo_ingreso = now()
   where id = auth.uid() and activo
   returning * into r;
  return r;
end $$;

-- Crear artículo (con stock inicial registrado como movimiento)
create or replace function public.crear_articulo(
  p_codigo text, p_nombre text, p_marca text, p_veh_marca text, p_veh_modelo text,
  p_categoria text, p_ubicacion text, p_stock integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ini integer := greatest(coalesce(p_stock, 0), 0);
begin
  if public.mi_rol() not in ('admin','operador') or public.mi_rol() is null then
    raise exception 'No tenés permiso para crear artículos.';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escribí el nombre del artículo.';
  end if;
  if coalesce(trim(p_codigo), '') <> '' and exists (select 1 from public.articulos where lower(codigo) = lower(trim(p_codigo))) then
    raise exception 'Ya existe un artículo con ese código.';
  end if;
  insert into public.articulos (codigo, nombre, marca, veh_marca, veh_modelo, categoria, ubicacion, stock)
  values (coalesce(trim(p_codigo),''), trim(p_nombre), coalesce(trim(p_marca),''), coalesce(trim(p_veh_marca),''),
          coalesce(trim(p_veh_modelo),''), coalesce(nullif(p_categoria,''),'Otros'), coalesce(trim(p_ubicacion),''), v_ini)
  returning id into v_id;
  if v_ini > 0 then
    insert into public.movimientos (articulo_id, tipo, cantidad, antes, despues, motivo, por)
    values (v_id, 'entrada', v_ini, 0, v_ini, 'Stock inicial', auth.uid());
  end if;
  return v_id;
end $$;

-- Mover stock a mano: entrada, salida o ajuste (conteo)
create or replace function public.mover_stock(p_articulo uuid, p_tipo text, p_cantidad integer, p_motivo text default '')
returns integer
language plpgsql security definer set search_path = public as $$
declare v_rol text := public.mi_rol(); a public.articulos; v_desp integer; v_cant integer;
begin
  if v_rol is null or v_rol = 'lectura' then
    raise exception 'No tenés permiso para mover stock.';
  end if;
  if v_rol = 'taller' and p_tipo <> 'salida' then
    raise exception 'El rol Taller solo puede dar salida.';
  end if;
  if p_tipo not in ('entrada','salida','ajuste') then
    raise exception 'Tipo de movimiento no válido.';
  end if;
  if p_cantidad is null or p_cantidad < 0 or (p_tipo <> 'ajuste' and p_cantidad < 1) then
    raise exception 'Ingresá una cantidad válida.';
  end if;
  select * into a from public.articulos where id = p_articulo for update;
  if not found then raise exception 'El artículo ya no existe.'; end if;
  v_desp := case p_tipo when 'entrada' then a.stock + p_cantidad
                        when 'salida'  then a.stock - p_cantidad
                        else p_cantidad end;
  if v_desp < 0 then
    raise exception 'No hay stock suficiente de "%" (quedan %).', a.nombre, a.stock;
  end if;
  v_cant := case when p_tipo = 'ajuste' then abs(v_desp - a.stock) else p_cantidad end;
  update public.articulos set stock = v_desp where id = a.id;
  insert into public.movimientos (articulo_id, tipo, cantidad, antes, despues, motivo, por)
  values (a.id, p_tipo, v_cant, a.stock, v_desp, coalesce(trim(p_motivo),''), auth.uid());
  return v_desp;
end $$;

-- Deshacer una salida cargada a mano
--   Administrador: cualquiera, sin límite de tiempo.
--   Operador y Taller: solo las propias, dentro de las 24 horas.
create or replace function public.anular_salida(p_movimiento uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_rol text := public.mi_rol(); m public.movimientos; a public.articulos;
begin
  if v_rol is null or v_rol = 'lectura' then
    raise exception 'No tenés permiso para deshacer salidas.';
  end if;
  select * into m from public.movimientos where id = p_movimiento for update;
  if not found then raise exception 'No se encontró esa salida.'; end if;
  if m.tipo <> 'salida' or m.pedido is not null then
    raise exception 'Solo se pueden deshacer salidas cargadas a mano.';
  end if;
  if m.anulado_fecha is not null then raise exception 'Esa salida ya fue anulada.'; end if;
  if v_rol <> 'admin' and (m.por is distinct from auth.uid() or m.fecha < now() - interval '24 hours') then
    raise exception 'No podés deshacer esta salida.';
  end if;
  select * into a from public.articulos where id = m.articulo_id for update;
  update public.articulos set stock = a.stock + m.cantidad where id = a.id;
  update public.movimientos set anulado_por = auth.uid(), anulado_fecha = now() where id = m.id;
  insert into public.movimientos (articulo_id, tipo, cantidad, antes, despues, motivo, por, anula)
  values (a.id, 'anulacion', m.cantidad, a.stock, a.stock + m.cantidad,
          'Deshace salida del ' || to_char(m.fecha at time zone 'America/Montevideo', 'DD/MM/YY HH24:MI'),
          auth.uid(), m.id);
  return a.stock + m.cantidad;
end $$;

-- Cambiar el estado de un pedido. Al llegar a Entregado (cliente) o Recibido
-- (proveedor) mueve el stock de todos sus artículos en una sola operación.
create or replace function public.cambiar_estado_pedido(p_pedido uuid, p_estado text)
returns public.pedidos
language plpgsql security definer set search_path = public as $$
declare v_rol text := public.mi_rol(); p public.pedidos; r record; a public.articulos;
        v_falta text[] := '{}'; v_cant integer; v_final text;
begin
  if v_rol is null or v_rol not in ('admin','operador') then
    raise exception 'No tenés permiso para cambiar pedidos.';
  end if;
  select * into p from public.pedidos where id = p_pedido for update;
  if not found then raise exception 'El pedido ya no existe.'; end if;
  if not (p_estado = any(public.estados_pedido(p.tipo))) then
    raise exception 'Estado no válido para este pedido.';
  end if;
  v_final := public.estado_final(p.tipo);
  if p.estado in (v_final, 'Cancelado') then
    raise exception 'El pedido % está cerrado (%).', p.numero, p.estado;
  end if;
  if p_estado = p.estado then return p; end if;

  if p_estado = v_final and not p.stock_aplicado then
    -- agrupar por artículo, bloquear y verificar todo antes de mover nada
    for r in
      select (it->>'articulo_id')::uuid as aid, max(it->>'nombre') as nombre, sum((it->>'cantidad')::int) as cant
        from jsonb_array_elements(p.items) it
       where coalesce(it->>'articulo_id','') <> '' and coalesce((it->>'cantidad')::int, 0) > 0
       group by 1 order by 1
    loop
      select * into a from public.articulos where id = r.aid for update;
      if not found then
        v_falta := v_falta || r.nombre;
      elsif p.tipo = 'cliente' and a.stock < r.cant then
        v_falta := v_falta || a.nombre;
      end if;
    end loop;
    if array_length(v_falta, 1) > 0 then
      if p.tipo = 'cliente' then
        raise exception 'Falta stock para: %. Registrá la entrada antes de entregar.', array_to_string(v_falta, ', ');
      else
        raise exception 'Estos artículos ya no existen: %.', array_to_string(v_falta, ', ');
      end if;
    end if;
    for r in
      select (it->>'articulo_id')::uuid as aid, sum((it->>'cantidad')::int) as cant
        from jsonb_array_elements(p.items) it
       where coalesce(it->>'articulo_id','') <> '' and coalesce((it->>'cantidad')::int, 0) > 0
       group by 1 order by 1
    loop
      v_cant := r.cant;
      select * into a from public.articulos where id = r.aid;
      update public.articulos
         set stock = stock + case when p.tipo = 'cliente' then -v_cant else v_cant end
       where id = a.id;
      insert into public.movimientos (articulo_id, tipo, cantidad, antes, despues, motivo, pedido, por)
      values (a.id, case when p.tipo = 'cliente' then 'salida' else 'entrada' end, v_cant, a.stock,
              a.stock + case when p.tipo = 'cliente' then -v_cant else v_cant end,
              case when p.tipo = 'cliente' then 'Entrega a ' else 'Compra a ' end || p.contacto,
              p.numero, auth.uid());
    end loop;
    p.stock_aplicado := true;
  end if;

  update public.pedidos
     set estado = p_estado,
         stock_aplicado = p.stock_aplicado,
         historial_estados = historial_estados || jsonb_build_array(jsonb_build_object('estado', p_estado, 'fecha', now(), 'por', auth.uid()))
   where id = p.id
   returning * into p;
  return p;
end $$;

-- ---------- Permisos ----------------------------------------------------
-- Nadie escribe directo el stock, los movimientos ni los perfiles:
-- todo pasa por las funciones de arriba (o por la función admin-usuarios).

alter table public.perfiles    enable row level security;
alter table public.articulos   enable row level security;
alter table public.movimientos enable row level security;
alter table public.pedidos     enable row level security;

revoke all on public.perfiles, public.articulos, public.movimientos, public.pedidos from anon, authenticated;
grant select on public.perfiles, public.articulos, public.movimientos, public.pedidos to authenticated;
grant update (codigo, nombre, marca, veh_marca, veh_modelo, categoria, ubicacion) on public.articulos to authenticated;
grant delete on public.articulos to authenticated;
grant insert (tipo, contacto, telefono, fecha_estimada, notas, items) on public.pedidos to authenticated;
grant update (contacto, telefono, fecha_estimada, notas, items) on public.pedidos to authenticated;
grant delete on public.pedidos to authenticated;
grant usage on sequence public.pedidos_cliente_seq, public.pedidos_proveedor_seq to authenticated;

revoke all on function public.crear_articulo(text,text,text,text,text,text,text,integer),
                       public.mover_stock(uuid,text,integer,text),
                       public.anular_salida(uuid),
                       public.cambiar_estado_pedido(uuid,text),
                       public.registrar_ingreso(),
                       public.mi_rol() from public, anon;
grant execute on function public.crear_articulo(text,text,text,text,text,text,text,integer),
                          public.mover_stock(uuid,text,integer,text),
                          public.anular_salida(uuid),
                          public.cambiar_estado_pedido(uuid,text),
                          public.registrar_ingreso(),
                          public.mi_rol() to authenticated;

drop policy if exists leer on public.perfiles;
create policy leer on public.perfiles for select to authenticated using (public.mi_rol() is not null);

drop policy if exists leer on public.articulos;
create policy leer on public.articulos for select to authenticated using (public.mi_rol() is not null);
drop policy if exists editar on public.articulos;
create policy editar on public.articulos for update to authenticated
  using (public.mi_rol() in ('admin','operador')) with check (public.mi_rol() in ('admin','operador'));
drop policy if exists borrar on public.articulos;
create policy borrar on public.articulos for delete to authenticated using (public.mi_rol() in ('admin','operador'));

drop policy if exists leer on public.movimientos;
create policy leer on public.movimientos for select to authenticated using (public.mi_rol() is not null);

drop policy if exists leer on public.pedidos;
create policy leer on public.pedidos for select to authenticated using (public.mi_rol() in ('admin','operador','lectura'));
drop policy if exists crear on public.pedidos;
create policy crear on public.pedidos for insert to authenticated with check (public.mi_rol() in ('admin','operador'));
drop policy if exists editar on public.pedidos;
create policy editar on public.pedidos for update to authenticated
  using (public.mi_rol() in ('admin','operador')) with check (public.mi_rol() in ('admin','operador'));
drop policy if exists borrar on public.pedidos;
create policy borrar on public.pedidos for delete to authenticated using (public.mi_rol() in ('admin','operador'));

-- ---------- Tiempo real (la app se actualiza sola cuando otro carga algo) ----
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['perfiles','articulos','movimientos','pedidos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

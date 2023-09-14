CREATE TABLE "parties" (
    "key" uuid unique not null,
    "type" text not null,
    "name" text not null,
    "alias" text,
    "dateofbirth" timestamp with time zone,
    "imageurl" text,
    "login" text,
    "password" text,
    "secondsperunit" integer,
    "currencyname" text,
    "status" text not null, /* active, inactive, ... */
  
    "$$meta.deleted" boolean not null default false,
    "$$meta.modified" timestamp with time zone not null default current_timestamp,
    "$$meta.created" timestamp with time zone not null default current_timestamp
);

CREATE TABLE "partyattachments" (
    "key" uuid unique not null,
    "filename" text,
    "party" uuid references "parties"(key) not null
);

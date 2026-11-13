import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, sha256, DEFAULT_REVIEW_TEMPLATES } from "@appolo/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
for (const candidate of [path.join(pkgRoot, ".env"), path.join(pkgRoot, "..", "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

import { getAdminDb, withOrgAdmin } from "./client";
import * as schema from "./schema";
const {
  orgs,
  locations,
  users,
  memberships,
  contacts,
  contactChannels,
  consentRecords,
  channels,
  phoneNumbers,
  conversations,
  messages,
  savedReplies,
  reviewPlatforms,
  reviews,
  reviewRequests,
  reviewTemplates,
  reviewTokens,
  privateFeedback,
  reviewWidgets,
  automations,
  automationSteps,
  campaigns,
  campaignRecipients,
  tags,
  contactTags,
  aiAgents,
  aiKnowledgeDocs,
  aiKnowledgeChunks,
  catalogItems,
  itemRatings,
  catalogCredits,
  profiles,
  follows,
  pods,
  podItems,
  watchlist,
  ratingEvents,
  searchHistory,
  socialNotifications,
} = schema;

const db = getAdminDb();

const SEED_SLUG = "demo";
const email = (process.env.SEED_EMAIL ?? "owner@appolo.test").trim().toLowerCase();
const password = process.env.SEED_PASSWORD ?? "appolo-demo-1234";

type CatalogSeed = {
  kind: "movie" | "tv" | "music" | "podcast" | "book" | "game";
  title: string;
  subtitle: string;
  year: number;
  tags: string[];
  genres?: string[];
  trailerUrl?: string;
  /** Demo taste profile: pre-rated items for the seeded org. */
  elo?: number;
  matches?: number;
  wins?: number;
  losses?: number;
};

/**
 * A curated demo catalog spanning every media kind. Metadata here is factual
 * (title, creator, year) so the app works offline; real provider adapters can
 * replace this later behind env keys. No provider content is copied.
 */
const MEDIA_CATALOG: CatalogSeed[] = [
  // movies
  { kind: "movie", title: "The Godfather", subtitle: "Francis Ford Coppola", year: 1972, tags: ["crime", "drama"], elo: 1700, matches: 14, wins: 11, losses: 3 },
  { kind: "movie", title: "Parasite", subtitle: "Bong Joon-ho", year: 2019, tags: ["thriller", "drama"] },
  { kind: "movie", title: "Spirited Away", subtitle: "Hayao Miyazaki", year: 2001, tags: ["animation", "fantasy"], elo: 1740, matches: 12, wins: 10, losses: 2 },
  { kind: "movie", title: "The Dark Knight", subtitle: "Christopher Nolan", year: 2008, tags: ["superhero", "action"] },
  { kind: "movie", title: "Everything Everywhere All at Once", subtitle: "Daniels", year: 2022, tags: ["sci-fi", "comedy"] },
  { kind: "movie", title: "Pulp Fiction", subtitle: "Quentin Tarantino", year: 1994, tags: ["crime", "drama"] },
  { kind: "movie", title: "In the Mood for Love", subtitle: "Wong Kar-wai", year: 2000, tags: ["romance", "drama"] },
  { kind: "movie", title: "Mad Max: Fury Road", subtitle: "George Miller", year: 2015, tags: ["action", "sci-fi"] },
  { kind: "movie", title: "Get Out", subtitle: "Jordan Peele", year: 2017, tags: ["horror", "thriller"] },
  { kind: "movie", title: "The Grand Budapest Hotel", subtitle: "Wes Anderson", year: 2014, tags: ["comedy", "drama"] },
  { kind: "movie", title: "Interstellar", subtitle: "Christopher Nolan", year: 2014, tags: ["sci-fi", "drama"] },
  { kind: "movie", title: "Whiplash", subtitle: "Damien Chazelle", year: 2014, tags: ["drama", "music"] },
  { kind: "movie", title: "Seven Samurai", subtitle: "Akira Kurosawa", year: 1954, tags: ["action", "drama"] },
  { kind: "movie", title: "2001: A Space Odyssey", subtitle: "Stanley Kubrick", year: 1968, tags: ["sci-fi", "classic"] },
  { kind: "movie", title: "Do the Right Thing", subtitle: "Spike Lee", year: 1989, tags: ["drama", "comedy"] },
  { kind: "movie", title: "Goodfellas", subtitle: "Martin Scorsese", year: 1990, tags: ["crime", "drama"] },
  { kind: "movie", title: "City of God", subtitle: "Fernando Meirelles", year: 2002, tags: ["crime", "drama"] },
  { kind: "movie", title: "Eternal Sunshine of the Spotless Mind", subtitle: "Michel Gondry", year: 2004, tags: ["romance", "sci-fi"] },
  { kind: "movie", title: "No Country for Old Men", subtitle: "Joel Coen", year: 2007, tags: ["crime", "thriller"] },
  { kind: "movie", title: "There Will Be Blood", subtitle: "Paul Thomas Anderson", year: 2007, tags: ["drama", "historical"] },
  { kind: "movie", title: "Moonlight", subtitle: "Barry Jenkins", year: 2016, tags: ["drama", "romance"] },
  { kind: "movie", title: "Portrait of a Lady on Fire", subtitle: "Céline Sciamma", year: 2019, tags: ["romance", "drama"] },
  { kind: "movie", title: "Arrival", subtitle: "Denis Villeneuve", year: 2016, tags: ["sci-fi", "drama"] },
  { kind: "movie", title: "Blade Runner 2049", subtitle: "Denis Villeneuve", year: 2017, tags: ["sci-fi", "thriller"] },
  { kind: "movie", title: "The Lord of the Rings: The Fellowship of the Ring", subtitle: "Peter Jackson", year: 2001, tags: ["fantasy", "adventure"] },
  { kind: "movie", title: "Alien", subtitle: "Ridley Scott", year: 1979, tags: ["horror", "sci-fi"] },
  { kind: "movie", title: "Clueless", subtitle: "Amy Heckerling", year: 1995, tags: ["comedy", "romance"] },
  { kind: "movie", title: "The Shawshank Redemption", subtitle: "Frank Darabont", year: 1994, tags: ["drama"] },
  { kind: "movie", title: "Rear Window", subtitle: "Alfred Hitchcock", year: 1954, tags: ["thriller", "mystery"] },
  { kind: "movie", title: "Pan's Labyrinth", subtitle: "Guillermo del Toro", year: 2006, tags: ["fantasy", "drama"] },
  { kind: "movie", title: "The Social Network", subtitle: "David Fincher", year: 2010, tags: ["drama"] },
  { kind: "movie", title: "Dune: Part Two", subtitle: "Denis Villeneuve", year: 2024, tags: ["sci-fi", "epic"] },
  // tv
  { kind: "tv", title: "The Sopranos", subtitle: "David Chase", year: 1999, tags: ["crime", "drama"] },
  { kind: "tv", title: "Breaking Bad", subtitle: "Vince Gilligan", year: 2008, tags: ["crime", "drama"], elo: 1770, matches: 15, wins: 13, losses: 2 },
  { kind: "tv", title: "The Wire", subtitle: "David Simon", year: 2002, tags: ["crime", "drama"] },
  { kind: "tv", title: "Fleabag", subtitle: "Phoebe Waller-Bridge", year: 2016, tags: ["comedy", "drama"], elo: 1680, matches: 9, wins: 7, losses: 2 },
  { kind: "tv", title: "Succession", subtitle: "Jesse Armstrong", year: 2018, tags: ["drama", "comedy"] },
  { kind: "tv", title: "The Bear", subtitle: "Christopher Storer", year: 2022, tags: ["drama", "comedy"], elo: 1690, matches: 10, wins: 8, losses: 2 },
  { kind: "tv", title: "Twin Peaks", subtitle: "David Lynch", year: 1990, tags: ["mystery", "drama"] },
  { kind: "tv", title: "Arcane", subtitle: "Christian Linke", year: 2021, tags: ["animation", "action"] },
  { kind: "tv", title: "Better Call Saul", subtitle: "Vince Gilligan", year: 2015, tags: ["crime", "drama"] },
  { kind: "tv", title: "Severance", subtitle: "Dan Erickson", year: 2022, tags: ["sci-fi", "thriller"], elo: 1670, matches: 8, wins: 6, losses: 2 },
  { kind: "tv", title: "The Twilight Zone", subtitle: "Rod Serling", year: 1959, tags: ["sci-fi", "anthology"] },
  { kind: "tv", title: "Cheers", subtitle: "James Burrows", year: 1982, tags: ["comedy"] },
  { kind: "tv", title: "Seinfeld", subtitle: "Larry David", year: 1989, tags: ["comedy"] },
  { kind: "tv", title: "The X-Files", subtitle: "Chris Carter", year: 1993, tags: ["sci-fi", "mystery"] },
  { kind: "tv", title: "The West Wing", subtitle: "Aaron Sorkin", year: 1999, tags: ["drama", "politics"] },
  { kind: "tv", title: "Deadwood", subtitle: "David Milch", year: 2004, tags: ["western", "drama"] },
  { kind: "tv", title: "Mad Men", subtitle: "Matthew Weiner", year: 2007, tags: ["drama"] },
  { kind: "tv", title: "Parks and Recreation", subtitle: "Greg Daniels", year: 2009, tags: ["comedy"] },
  { kind: "tv", title: "Community", subtitle: "Dan Harmon", year: 2009, tags: ["comedy"] },
  { kind: "tv", title: "BoJack Horseman", subtitle: "Raphael Bob-Waksberg", year: 2014, tags: ["animation", "comedy"] },
  { kind: "tv", title: "Mr. Robot", subtitle: "Sam Esmail", year: 2015, tags: ["thriller", "drama"] },
  { kind: "tv", title: "Atlanta", subtitle: "Donald Glover", year: 2016, tags: ["comedy", "drama"] },
  { kind: "tv", title: "The Good Place", subtitle: "Michael Schur", year: 2016, tags: ["comedy", "fantasy"] },
  { kind: "tv", title: "Barry", subtitle: "Alec Berg", year: 2018, tags: ["comedy", "crime"] },
  { kind: "tv", title: "Chernobyl", subtitle: "Craig Mazin", year: 2019, tags: ["drama", "historical"] },
  { kind: "tv", title: "Watchmen", subtitle: "Damon Lindelof", year: 2019, tags: ["superhero", "drama"] },
  { kind: "tv", title: "Ted Lasso", subtitle: "Bill Lawrence", year: 2020, tags: ["comedy", "sports"] },
  { kind: "tv", title: "The Last of Us", subtitle: "Craig Mazin", year: 2023, tags: ["drama", "post-apocalyptic"] },
  // music
  { kind: "music", title: "Blonde", subtitle: "Frank Ocean", year: 2016, tags: ["r&b", "alternative"], elo: 1650, matches: 11, wins: 8, losses: 3 },
  { kind: "music", title: "Kid A", subtitle: "Radiohead", year: 2000, tags: ["alternative", "electronic"], elo: 1660, matches: 10, wins: 8, losses: 2 },
  { kind: "music", title: "To Pimp a Butterfly", subtitle: "Kendrick Lamar", year: 2015, tags: ["hip-hop", "jazz"], elo: 1720, matches: 12, wins: 10, losses: 2 },
  { kind: "music", title: "Rumours", subtitle: "Fleetwood Mac", year: 1977, tags: ["rock", "classic"] },
  { kind: "music", title: "Blue", subtitle: "Joni Mitchell", year: 1971, tags: ["folk", "singer-songwriter"] },
  { kind: "music", title: "The Dark Side of the Moon", subtitle: "Pink Floyd", year: 1973, tags: ["rock", "progressive"] },
  { kind: "music", title: "In Rainbows", subtitle: "Radiohead", year: 2007, tags: ["alternative", "rock"] },
  { kind: "music", title: "Vespertine", subtitle: "Björk", year: 2001, tags: ["electronic", "art pop"] },
  { kind: "music", title: "The Miseducation of Lauryn Hill", subtitle: "Lauryn Hill", year: 1998, tags: ["hip-hop", "r&b"] },
  { kind: "music", title: "Sound of Silver", subtitle: "LCD Soundsystem", year: 2007, tags: ["electronic", "dance"] },
  { kind: "music", title: "OK Computer", subtitle: "Radiohead", year: 1997, tags: ["alternative", "rock"] },
  { kind: "music", title: "Illmatic", subtitle: "Nas", year: 1994, tags: ["hip-hop"] },
  { kind: "music", title: "The Queen Is Dead", subtitle: "The Smiths", year: 1986, tags: ["indie", "rock"] },
  { kind: "music", title: "Hounds of Love", subtitle: "Kate Bush", year: 1985, tags: ["art pop"] },
  { kind: "music", title: "Songs in the Key of Life", subtitle: "Stevie Wonder", year: 1976, tags: ["soul", "funk"] },
  { kind: "music", title: "Purple Rain", subtitle: "Prince", year: 1984, tags: ["pop", "funk"] },
  { kind: "music", title: "Grace", subtitle: "Jeff Buckley", year: 1994, tags: ["rock", "singer-songwriter"] },
  { kind: "music", title: "Homogenic", subtitle: "Björk", year: 1997, tags: ["electronic", "art pop"] },
  { kind: "music", title: "The Blueprint", subtitle: "Jay-Z", year: 2001, tags: ["hip-hop"] },
  { kind: "music", title: "Is This It", subtitle: "The Strokes", year: 2001, tags: ["indie rock"] },
  { kind: "music", title: "Funeral", subtitle: "Arcade Fire", year: 2004, tags: ["indie rock"] },
  { kind: "music", title: "Back to Black", subtitle: "Amy Winehouse", year: 2006, tags: ["soul", "pop"] },
  { kind: "music", title: "Channel Orange", subtitle: "Frank Ocean", year: 2012, tags: ["r&b", "alternative"] },
  { kind: "music", title: "good kid, m.A.A.d city", subtitle: "Kendrick Lamar", year: 2012, tags: ["hip-hop"] },
  { kind: "music", title: "Lemonade", subtitle: "Beyoncé", year: 2016, tags: ["pop", "r&b"] },
  { kind: "music", title: "A Seat at the Table", subtitle: "Solange", year: 2016, tags: ["r&b", "soul"] },
  { kind: "music", title: "Punisher", subtitle: "Phoebe Bridgers", year: 2020, tags: ["indie folk"] },
  { kind: "music", title: "Renaissance", subtitle: "Beyoncé", year: 2022, tags: ["dance", "pop"] },
  // podcasts
  { kind: "podcast", title: "Serial", subtitle: "Sarah Koenig", year: 2014, tags: ["true crime", "investigative"], elo: 1640, matches: 7, wins: 5, losses: 2 },
  { kind: "podcast", title: "Radiolab", subtitle: "Jad Abumrad", year: 2002, tags: ["science", "storytelling"] },
  { kind: "podcast", title: "The Daily", subtitle: "The New York Times", year: 2017, tags: ["news", "daily"], elo: 1600, matches: 6, wins: 4, losses: 2 },
  { kind: "podcast", title: "99% Invisible", subtitle: "Roman Mars", year: 2010, tags: ["design", "culture"] },
  { kind: "podcast", title: "Hardcore History", subtitle: "Dan Carlin", year: 2006, tags: ["history", "long-form"] },
  { kind: "podcast", title: "My Favorite Murder", subtitle: "Karen Kilgariff", year: 2016, tags: ["true crime", "comedy"] },
  { kind: "podcast", title: "Reply All", subtitle: "PJ Vogt", year: 2014, tags: ["technology", "internet"] },
  { kind: "podcast", title: "The Ezra Klein Show", subtitle: "Ezra Klein", year: 2016, tags: ["politics", "interviews"] },
  { kind: "podcast", title: "This American Life", subtitle: "Ira Glass", year: 1995, tags: ["storytelling", "journalism"] },
  { kind: "podcast", title: "Freakonomics Radio", subtitle: "Stephen Dubner", year: 2010, tags: ["economics", "interviews"] },
  { kind: "podcast", title: "WTF with Marc Maron", subtitle: "Marc Maron", year: 2009, tags: ["comedy", "interviews"] },
  { kind: "podcast", title: "Conan O'Brien Needs a Friend", subtitle: "Conan O'Brien", year: 2018, tags: ["comedy", "interviews"] },
  { kind: "podcast", title: "Stuff You Should Know", subtitle: "Josh Clark", year: 2008, tags: ["education"] },
  { kind: "podcast", title: "Planet Money", subtitle: "NPR", year: 2008, tags: ["economics"] },
  { kind: "podcast", title: "Welcome to Night Vale", subtitle: "Joseph Fink", year: 2012, tags: ["fiction", "surreal"] },
  { kind: "podcast", title: "The Adventure Zone", subtitle: "McElroy family", year: 2014, tags: ["actual play", "comedy"] },
  { kind: "podcast", title: "Revisionist History", subtitle: "Malcolm Gladwell", year: 2016, tags: ["history"] },
  { kind: "podcast", title: "Pod Save America", subtitle: "Jon Favreau", year: 2017, tags: ["politics"] },
  { kind: "podcast", title: "Darknet Diaries", subtitle: "Jack Rhysider", year: 2017, tags: ["technology", "true crime"] },
  { kind: "podcast", title: "Ologies", subtitle: "Alie Ward", year: 2017, tags: ["science", "interviews"] },
  // books
  { kind: "book", title: "Beloved", subtitle: "Toni Morrison", year: 1987, tags: ["literary", "historical"], elo: 1680, matches: 8, wins: 6, losses: 2 },
  { kind: "book", title: "One Hundred Years of Solitude", subtitle: "Gabriel García Márquez", year: 1967, tags: ["magical realism", "literary"] },
  { kind: "book", title: "The Left Hand of Darkness", subtitle: "Ursula K. Le Guin", year: 1969, tags: ["sci-fi", "literary"] },
  { kind: "book", title: "Dune", subtitle: "Frank Herbert", year: 1965, tags: ["sci-fi", "epic"], elo: 1620, matches: 7, wins: 5, losses: 2 },
  { kind: "book", title: "Normal People", subtitle: "Sally Rooney", year: 2018, tags: ["romance", "contemporary"] },
  { kind: "book", title: "The Secret History", subtitle: "Donna Tartt", year: 1992, tags: ["mystery", "literary"] },
  { kind: "book", title: "Piranesi", subtitle: "Susanna Clarke", year: 2020, tags: ["fantasy", "mystery"], elo: 1700, matches: 9, wins: 7, losses: 2 },
  { kind: "book", title: "East of Eden", subtitle: "John Steinbeck", year: 1952, tags: ["classic", "literary"] },
  { kind: "book", title: "The Remains of the Day", subtitle: "Kazuo Ishiguro", year: 1989, tags: ["literary", "historical"] },
  { kind: "book", title: "Project Hail Mary", subtitle: "Andy Weir", year: 2021, tags: ["sci-fi", "adventure"] },
  { kind: "book", title: "The Great Gatsby", subtitle: "F. Scott Fitzgerald", year: 1925, tags: ["classic", "literary"] },
  { kind: "book", title: "1984", subtitle: "George Orwell", year: 1949, tags: ["dystopian", "classic"] },
  { kind: "book", title: "Jane Eyre", subtitle: "Charlotte Brontë", year: 1847, tags: ["classic", "romance"] },
  { kind: "book", title: "Moby-Dick", subtitle: "Herman Melville", year: 1851, tags: ["classic", "adventure"] },
  { kind: "book", title: "Crime and Punishment", subtitle: "Fyodor Dostoevsky", year: 1866, tags: ["classic", "psychological"] },
  { kind: "book", title: "The Master and Margarita", subtitle: "Mikhail Bulgakov", year: 1967, tags: ["magical realism", "satire"] },
  { kind: "book", title: "Blood Meridian", subtitle: "Cormac McCarthy", year: 1985, tags: ["western", "literary"] },
  { kind: "book", title: "The Handmaid's Tale", subtitle: "Margaret Atwood", year: 1985, tags: ["dystopian", "literary"] },
  { kind: "book", title: "Norwegian Wood", subtitle: "Haruki Murakami", year: 1987, tags: ["romance", "literary"] },
  { kind: "book", title: "American Psycho", subtitle: "Bret Easton Ellis", year: 1991, tags: ["satire", "horror"] },
  { kind: "book", title: "The Wind-Up Bird Chronicle", subtitle: "Haruki Murakami", year: 1994, tags: ["magical realism", "mystery"] },
  { kind: "book", title: "Infinite Jest", subtitle: "David Foster Wallace", year: 1996, tags: ["literary", "postmodern"] },
  { kind: "book", title: "The Road", subtitle: "Cormac McCarthy", year: 2006, tags: ["post-apocalyptic", "literary"] },
  { kind: "book", title: "The Brief Wondrous Life of Oscar Wao", subtitle: "Junot Díaz", year: 2007, tags: ["literary", "contemporary"] },
  { kind: "book", title: "The Hunger Games", subtitle: "Suzanne Collins", year: 2008, tags: ["ya", "dystopian"] },
  { kind: "book", title: "A Visit from the Goon Squad", subtitle: "Jennifer Egan", year: 2010, tags: ["literary", "music"] },
  { kind: "book", title: "Gone Girl", subtitle: "Gillian Flynn", year: 2012, tags: ["thriller", "mystery"] },
  { kind: "book", title: "The Sellout", subtitle: "Paul Beatty", year: 2015, tags: ["satire", "literary"] },
  { kind: "book", title: "Pachinko", subtitle: "Min Jin Lee", year: 2017, tags: ["historical", "literary"] },
  { kind: "book", title: "Klara and the Sun", subtitle: "Kazuo Ishiguro", year: 2021, tags: ["sci-fi", "literary"] },
  { kind: "book", title: "Tomorrow, and Tomorrow, and Tomorrow", subtitle: "Gabrielle Zevin", year: 2022, tags: ["contemporary", "games"] },
  // games
  { kind: "game", title: "Hollow Knight", subtitle: "Team Cherry", year: 2017, tags: ["metroidvania", "indie"], genres: ["Action", "Adventure", "Indie"], elo: 1760, matches: 13, wins: 11, losses: 2 },
  { kind: "game", title: "Elden Ring", subtitle: "FromSoftware", year: 2022, tags: ["rpg", "open world"], genres: ["Action", "RPG"] },
  { kind: "game", title: "Hades", subtitle: "Supergiant Games", year: 2020, tags: ["roguelike", "indie"], genres: ["Action", "Indie"], elo: 1710, matches: 10, wins: 8, losses: 2 },
  { kind: "game", title: "Disco Elysium", subtitle: "ZA/UM", year: 2019, tags: ["rpg", "narrative"], genres: ["RPG", "Adventure"] },
  { kind: "game", title: "The Legend of Zelda: Breath of the Wild", subtitle: "Nintendo", year: 2017, tags: ["adventure", "open world"], genres: ["Adventure", "Action"] },
  { kind: "game", title: "Portal 2", subtitle: "Valve", year: 2011, tags: ["puzzle", "co-op"], genres: ["Puzzle", "Adventure"], elo: 1690, matches: 9, wins: 7, losses: 2 },
  { kind: "game", title: "The Witcher 3: Wild Hunt", subtitle: "CD Projekt Red", year: 2015, tags: ["rpg", "open world"], genres: ["RPG", "Adventure"] },
  { kind: "game", title: "Red Dead Redemption 2", subtitle: "Rockstar Games", year: 2018, tags: ["action", "open world"], genres: ["Action", "Adventure"] },
  { kind: "game", title: "Bloodborne", subtitle: "FromSoftware", year: 2015, tags: ["action", "rpg"], genres: ["Action", "RPG"] },
  { kind: "game", title: "Sekiro: Shadows Die Twice", subtitle: "FromSoftware", year: 2019, tags: ["action", "soulslike"], genres: ["Action", "Adventure"] },
  { kind: "game", title: "Celeste", subtitle: "Maddy Makes Games", year: 2018, tags: ["platformer", "indie"], genres: ["Platformer", "Indie"] },
  { kind: "game", title: "Stardew Valley", subtitle: "ConcernedApe", year: 2016, tags: ["simulation", "indie"], genres: ["Simulation", "RPG"] },
  { kind: "game", title: "The Last of Us Part II", subtitle: "Naughty Dog", year: 2020, tags: ["action", "narrative"], genres: ["Action", "Adventure"] },
  { kind: "game", title: "God of War", subtitle: "Santa Monica Studio", year: 2018, tags: ["action", "adventure"], genres: ["Action", "Adventure"] },
  { kind: "game", title: "Outer Wilds", subtitle: "Mobius Digital", year: 2019, tags: ["mystery", "exploration"], genres: ["Adventure", "Mystery"] },
  { kind: "game", title: "Return of the Obra Dinn", subtitle: "Lucas Pope", year: 2018, tags: ["puzzle", "mystery"], genres: ["Puzzle", "Adventure"] },
  { kind: "game", title: "Baldur's Gate 3", subtitle: "Larian Studios", year: 2023, tags: ["rpg", "turn-based"], genres: ["RPG", "Adventure"] },
  { kind: "game", title: "Animal Crossing: New Horizons", subtitle: "Nintendo", year: 2020, tags: ["simulation", "life"], genres: ["Simulation"] },
  { kind: "game", title: "Mario Kart 8 Deluxe", subtitle: "Nintendo", year: 2017, tags: ["racing", "multiplayer"], genres: ["Racing"] },
  { kind: "game", title: "Slay the Spire", subtitle: "Mega Crit", year: 2019, tags: ["roguelike", "card"], genres: ["Strategy", "Indie"] },
  { kind: "game", title: "Inside", subtitle: "Playdead", year: 2016, tags: ["puzzle", "platformer"], genres: ["Puzzle", "Adventure"] },

];

/** Short, original overview blurbs (factual metadata only). */
const DESCRIPTIONS: Record<string, string> = {
  "The Godfather": "Francis Ford Coppola's crime saga follows the Corleone family across a decade of loyalty, power, and loss.",
  "Spirited Away": "Hayao Miyazaki's coming-of-age fantasy sends a young girl into a spirit world of bathhouses, gods, and quiet courage.",
  Parasite: "Bong Joon-ho's genre-bending thriller about two families and the slippery gap between them.",
  "Mad Max: Fury Road": "George Miller's chase film: two hours of roaring engines, practical stunts, and a rebellion at speed.",
  "Breaking Bad": "A chemistry teacher turns to making meth to provide for his family, and keeps going far past that.",
  "The Bear": "A fine-dining chef inherits his brother's chaotic Chicago sandwich shop.",
  Fleabag: "Phoebe Waller-Bridge's comedy about grief, family, and talking straight to the audience.",
  Severance: "Employees at Lumon agree to surgically separate their work and personal memories.",
  "Better Call Saul": "The slow, careful tragedy of how Jimmy McGill became Saul Goodman.",
  Blonde: "Frank Ocean's lush, shape-shifting album about memory, queerness, and growing up.",
  "To Pimp a Butterfly": "Kendrick Lamar's dense, jazz-soaked record about race, fame, and self-worth.",
  "Kid A": "Radiohead's turn toward electronics: cold textures around warm, uneasy songs.",
  "In Rainbows": "Radiohead at their most direct, built on restless rhythms and quiet dread.",
  Serial: "Sarah Koenig reopens a 1999 murder case across a season of investigative reporting.",
  "Hardcore History": "Dan Carlin's long-form history, often longer than the events themselves.",
  Piranesi: "Susanna Clarke's strange, gentle mystery set inside an endless house.",
  Beloved: "Toni Morrison's Pulitzer-winning novel about slavery, memory, and a haunting.",
  Dune: "Frank Herbert's desert epic of politics, ecology, and prophecy on the planet Arrakis.",
  "Project Hail Mary": "Andy Weir's lone-astronaut problem-solving adventure across the stars.",
};

const CREDITS: Record<string, Array<{ name: string; slug: string; role: string; character?: string }>> = {
  "The Godfather": [
    { name: "Marlon Brando", slug: "marlon-brando", role: "actor", character: "Don Vito Corleone" },
    { name: "Al Pacino", slug: "al-pacino", role: "actor", character: "Michael Corleone" },
    { name: "Francis Ford Coppola", slug: "francis-ford-coppola", role: "director" },
  ],
  "Parasite": [
    { name: "Song Kang-ho", slug: "song-kang-ho", role: "actor", character: "Ki Taek" },
    { name: "Bong Joon-ho", slug: "bong-joon-ho", role: "director" },
  ],
  "Spirited Away": [
    { name: "Rumi Hiiragi", slug: "rumi-hiiragi", role: "actor", character: "Chihiro (voice)" },
    { name: "Hayao Miyazaki", slug: "hayao-miyazaki", role: "director" },
  ],
  "Breaking Bad": [
    { name: "Bryan Cranston", slug: "bryan-cranston", role: "actor", character: "Walter White" },
    { name: "Aaron Paul", slug: "aaron-paul", role: "actor", character: "Jesse Pinkman" },
    { name: "Vince Gilligan", slug: "vince-gilligan", role: "creator" },
  ],
  "Blonde": [{ name: "Frank Ocean", slug: "frank-ocean", role: "artist" }],
  "To Pimp a Butterfly": [{ name: "Kendrick Lamar", slug: "kendrick-lamar", role: "artist" }],
  "Beloved": [{ name: "Toni Morrison", slug: "toni-morrison", role: "author" }],
  "Dune": [{ name: "Frank Herbert", slug: "frank-herbert", role: "author" }],
  "Piranesi": [{ name: "Susanna Clarke", slug: "susanna-clarke", role: "author" }],
  "Hollow Knight": [{ name: "Team Cherry", slug: "team-cherry", role: "developer" }],
  "Elden Ring": [{ name: "FromSoftware", slug: "fromsoftware", role: "developer" }],
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function spotifyLink(item: CatalogSeed): string | null {
  if (item.kind === "music") return `https://open.spotify.com/search/${encodeURIComponent(item.title)}`;
  return null;
}

type CoverSeed = { kind: string; title: string; subtitle: string; year: number | null };

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when two titles refer to the same work (ignoring punctuation and extra words). */
function titleMatches(candidate: string, wanted: string): boolean {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(wanted);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const WIKI_UA = "AppoloSeed/1.0 (https://github.com/harabirsi2/appolo; dev@local)";

/** Wikipedia asks for a descriptive UA and throttles anonymous bursts; retry politely. */
async function wikiSummary(title: string): Promise<{ thumbnail?: { source?: string }; type?: string } | null> {
  const url =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(title.replace(/ /g, "_"));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": WIKI_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as { thumbnail?: { source?: string }; type?: string };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
}

/** Search Wikipedia and return the first non-disambiguation thumbnail. */
async function wikipediaCover(titles: string[]): Promise<string | null> {
  for (const title of titles) {
    const data = await wikiSummary(title);
    if (data && data.type !== "disambiguation" && data.thumbnail?.source) {
      return data.thumbnail.source;
    }
  }
  return null;
}

/** Open Library search gives the right edition cover for a title + author. */
async function openLibraryCover(item: CoverSeed): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      title: item.title,
      limit: "5",
      fields: "title,author_name,cover_i",
    });
    if (item.subtitle) params.set("author", item.subtitle);
    const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        docs?: Array<{ title?: string; author_name?: string[]; cover_i?: number }>;
      };
      for (const doc of data.docs ?? []) {
        if (!doc.cover_i || !doc.title) continue;
        if (!titleMatches(doc.title, item.title)) continue;
        if (item.subtitle) {
          const authors = (doc.author_name ?? []).map(normalizeTitle);
          if (!authors.some((author) => author.includes(normalizeTitle(item.subtitle)))) continue;
        }
        return `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
      }
    }
  } catch {
    // fall through to the title endpoint
  }
  return `https://covers.openlibrary.org/b/title/${encodeURIComponent(item.title)}-L.jpg`;
}

/** TVmaze has keyless poster art for nearly every TV series. */
async function tvmazeCover(item: CoverSeed): Promise<string | null> {
  try {
    const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(item.title)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      show?: { name?: string; premiered?: string | null; image?: { original?: string; medium?: string } };
    }>;
    for (const entry of data) {
      const show = entry.show;
      if (!show?.name || !show.image) continue;
      if (!titleMatches(show.name, item.title)) continue;
      if (item.year && show.premiered) {
        const premieredYear = Number(show.premiered.slice(0, 4));
        if (Number.isFinite(premieredYear) && Math.abs(premieredYear - item.year) > 1) continue;
      }
      return show.image.original ?? show.image.medium ?? null;
    }
  } catch {
    // fall through
  }
  return null;
}

/** iTunes artwork for albums and podcasts, with an artist-aware query. */
async function itunesCover(item: CoverSeed): Promise<string | null> {
  const media = item.kind === "music" ? "music" : item.kind === "podcast" ? "podcast" : null;
  if (!media) return null;
  const entity = item.kind === "music" ? "album" : "podcast";
  const term = item.kind === "music" ? `${item.title} ${item.subtitle}` : item.title;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=${media}&entity=${entity}&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    for (const row of data.results ?? []) {
      const name = (row.collectionName as string) ?? "";
      const artist = (row.artistName as string) ?? "";
      if (!titleMatches(name, item.title)) continue;
      if (item.kind === "music" && item.subtitle && !titleMatches(artist, item.subtitle)) continue;
      const art = (row.artworkUrl600 as string) || (row.artworkUrl100 as string) || "";
      if (!art) continue;
      return art.replace("100x100bb", "600x600bb").replace("100x100.jpg", "600x600.jpg");
    }
  } catch {
    // fall through
  }
  return null;
}

async function fetchCoverUrl(item: CoverSeed): Promise<string | null> {
  try {
    if (item.kind === "book") {
      return await openLibraryCover(item);
    }
    if (item.kind === "tv") {
      return (
        (await tvmazeCover(item)) ??
        (await wikipediaCover([
          item.year ? `${item.title} (${item.year} TV series)` : `${item.title} (TV series)`,
          `${item.title} (TV series)`,
          item.title,
        ]))
      );
    }
    if (item.kind === "movie" || item.kind === "game") {
      const suffixes =
        item.kind === "game" ? [" (video game)"] : [" (film)", " (movie)"];
      return await wikipediaCover([
        ...(item.year
          ? [`${item.title} (${item.year} film)`, `${item.title} (${item.year})`]
          : []),
        ...suffixes.map((suffix) => item.title + suffix),
        item.title,
      ]);
    }
    if (item.kind === "music") {
      return (
        (await itunesCover(item)) ??
        (await wikipediaCover([
          `${item.title} (${item.subtitle} album)`,
          `${item.title} (album)`,
          item.title,
        ]))
      );
    }
    if (item.kind === "podcast") {
      return await itunesCover(item);
    }
    return null;
  } catch {
    return null;
  }
}

const COVERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/public/covers",
);

/** Download remote artwork once so the app serves stable local files instead of hotlinking. */
async function cacheCover(row: CoverSeed, remoteUrl: string): Promise<string | null> {
  const ext = /\.png(\?|$)/i.test(remoteUrl) ? "png" : "jpg";
  const filename = `${row.kind}-${slugify(row.title)}.${ext}`;
  const file = path.join(COVERS_DIR, filename);
  if (existsSync(file)) return `/covers/${filename}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(remoteUrl, {
        headers: { "User-Agent": WIKI_UA, Accept: "image/*" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 1000) return null;
      await mkdir(COVERS_DIR, { recursive: true });
      await writeFile(file, bytes);
      return `/covers/${filename}`;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  return null;
}

async function enrichCoverImages(rows: Array<{ id: string; kind: string; title: string; subtitle: string; year: number | null; imageUrl: string | null }>): Promise<void> {
  const missing = rows.filter((row) => !row.imageUrl);
  const concurrency = 2;
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const remoteUrl = await fetchCoverUrl(row);
        if (!remoteUrl) return;
        const localPath = await cacheCover(row, remoteUrl);
        await db
          .update(catalogItems)
          .set({ imageUrl: localPath ?? remoteUrl })
          .where(eq(catalogItems.id, row.id));
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

/** Seed the shared catalog and, on first run, a demo org's taste profile. */
async function seedMedia(orgId: string): Promise<void> {
  await db
    .insert(catalogItems)
    .values(
      MEDIA_CATALOG.map((item) => {
        const spotify = spotifyLink(item);
        return {
          kind: item.kind,
          title: item.title,
          subtitle: item.subtitle,
          year: item.year,
          externalRef: `demo:${item.kind}:${slugify(item.title)}`,
          description: DESCRIPTIONS[item.title] ?? null,
          links: spotify ? { spotify } : {},
          genres: item.genres ?? [],
          trailerUrl: item.trailerUrl ?? (item.kind === "movie" || item.kind === "tv" ? `https://www.youtube.com/results?search_query=${encodeURIComponent(item.title + " trailer")}` : null),
          imageUrl: null,
          tags: item.tags,
        };
      }),
    )
    .onConflictDoUpdate({
      target: catalogItems.externalRef,
      set: {
        description: sql`excluded.description`,
        links: sql`excluded.links`,
        tags: sql`excluded.tags`,
        genres: sql`excluded.genres`,
        trailerUrl: sql`excluded.trailer_url`,
        imageUrl: sql`coalesce(excluded.image_url, ${catalogItems.imageUrl})`,
      },
    });

  const rows = await db
    .select({ id: catalogItems.id, kind: catalogItems.kind, title: catalogItems.title, subtitle: catalogItems.subtitle, year: catalogItems.year, imageUrl: catalogItems.imageUrl })
    .from(catalogItems);
  const idByKey = new Map(rows.map((row) => [`${row.kind}:${row.title}`, row.id]));

  // Fetch real cover art from public, keyless providers (best effort, cached in DB).
  await enrichCoverImages(rows);

  // Cast & crew links behind actor/director/artist pages.
  for (const [title, credits] of Object.entries(CREDITS)) {
    const itemRow = rows.find((row) => row.title === title);
    if (!itemRow) continue;
    for (let index = 0; index < credits.length; index += 1) {
      const credit = credits[index]!;
      await db
        .insert(catalogCredits)
        .values({
          itemId: itemRow.id,
          personName: credit.name,
          personSlug: credit.slug,
          role: credit.role,
          character: credit.character ?? null,
          position: index,
        })
        .onConflictDoNothing();
    }
  }

  await withOrgAdmin(orgId, async (tx) => {
    for (const item of MEDIA_CATALOG) {
      if (item.elo === undefined) continue;
      const itemId = idByKey.get(`${item.kind}:${item.title}`);
      if (!itemId) continue;
      await tx
        .insert(itemRatings)
        .values({
          orgId,
          itemId,
          elo: item.elo,
          matches: item.matches ?? 0,
          wins: item.wins ?? 0,
          losses: item.losses ?? 0,
        })
        .onConflictDoNothing();
    }
  });
}

type CommunityRating = { title: string; score: number; tags: string[]; text: string; spoiler?: boolean; favoriteCharacter?: string; favoriteTracks?: string[] };
type CommunityMember = {
  username: string;
  displayName: string;
  hue: number;
  bio: string;
  ratings: CommunityRating[];
  pod?: { title: string; slug: string; description: string; items: string[] };
};

/** Other taste profiles so the social surface has real content to show. */
const COMMUNITY: CommunityMember[] = [
  {
    username: "cart",
    displayName: "Cart",
    hue: 150,
    bio: "poptimist. albums > everything.",
    ratings: [
      { title: "Blonde", score: 8.9, tags: ["r&b"], text: "Endlessly replayable — the back half is the whole point." },
      { title: "To Pimp a Butterfly", score: 9.4, tags: ["hip-hop"], text: "A history lesson that also bangs." },
      { title: "Spirited Away", score: 9.2, tags: ["animation"], text: "Still the most beautiful thing Ghibli ever made.", spoiler: true, favoriteCharacter: "No-Face" },
      { title: "Fleabag", score: 8.8, tags: ["comedy"], text: "The fourth wall never gets old." },
      { title: "Kid A", score: 8.1, tags: ["electronic"], text: "Cold on the surface, warm underneath." },
    ],
    pod: { title: "2026 bangers", slug: "2026-bangers", description: "The records I cannot stop playing.", items: ["Blonde", "To Pimp a Butterfly", "Kid A"] },
  },
  {
    username: "noah",
    displayName: "Noah",
    hue: 25,
    bio: "movies, records, the occasional book.",
    ratings: [
      { title: "The Godfather", score: 9.3, tags: ["crime"], text: "Every frame is a poster." },
      { title: "Breaking Bad", score: 9.5, tags: ["drama"], text: "Perfect television, start to finish." },
      { title: "Parasite", score: 8.8, tags: ["thriller"], text: "Moves like a trapdoor." },
      { title: "Piranesi", score: 8.7, tags: ["fantasy"], text: "Quiet and strange and perfect." },
      { title: "In Rainbows", score: 8.5, tags: ["rock"], text: "Their warmest record." },
    ],
    pod: { title: "all-timers", slug: "all-timers", description: "No notes.", items: ["The Godfather", "Breaking Bad", "Parasite"] },
  },
  {
    username: "ava",
    displayName: "Ava",
    hue: 300,
    bio: "books, pods, and long walks.",
    ratings: [
      { title: "Beloved", score: 9.0, tags: ["literary"], text: "Devastating in the best way." },
      { title: "Serial", score: 8.4, tags: ["true crime"], text: "The one that started it all." },
      { title: "Severance", score: 8.6, tags: ["sci-fi"], text: "Cold, gripping, immaculate." },
      { title: "Dune", score: 7.9, tags: ["sci-fi"], text: "Worth it for the world-building." },
      { title: "The Bear", score: 8.2, tags: ["drama"], text: "Anxiety as television." },
    ],
    pod: { title: "comfort listens", slug: "comfort-listens", description: "For a slow weekend.", items: ["Serial", "The Bear"] },
  },
];

async function seedCommunity(ownerOrgId: string, ownerName: string): Promise<void> {
  const catalogRows = await db
    .select({ id: catalogItems.id, title: catalogItems.title })
    .from(catalogItems);
  const idByTitle = new Map(catalogRows.map((row) => [row.title, row.id]));

  await db
    .insert(profiles)
    .values({ orgId: ownerOrgId, username: "demo", displayName: ownerName, bio: "Building my podium.", avatarHue: 250 })
    .onConflictDoNothing();

  const demoPod: NonNullable<CommunityMember["pod"]> = {
    title: "podium staples",
    slug: "podium-staples",
    description: "The five I keep coming back to.",
    items: ["Breaking Bad", "Spirited Away", "To Pimp a Butterfly", "The Godfather", "Piranesi"],
  };
  let demoPodRow = (
    await db
      .select()
      .from(pods)
      .where(and(eq(pods.orgId, ownerOrgId), eq(pods.slug, demoPod.slug)))
      .limit(1)
  )[0];
  if (!demoPodRow) {
    demoPodRow = (
      await db
        .insert(pods)
        .values({
          orgId: ownerOrgId,
          title: demoPod.title,
          slug: demoPod.slug,
          description: demoPod.description,
          visibility: "public",
        })
        .returning()
    )[0]!;
  }
  for (let index = 0; index < demoPod.items.length; index += 1) {
    const itemId = idByTitle.get(demoPod.items[index]!);
    if (!itemId) continue;
    await db
      .insert(podItems)
      .values({ podId: demoPodRow.id, itemId, position: index })
      .onConflictDoNothing();
  }

  for (const member of COMMUNITY) {
    let orgRow = (await db.select().from(orgs).where(eq(orgs.slug, member.username)).limit(1))[0];
    if (!orgRow) {
      orgRow = (
        await db
          .insert(orgs)
          .values({ name: member.displayName, slug: member.username, planTier: "free" })
          .returning()
      )[0]!;
    }
    const memberOrgId = orgRow.id;

    await db
      .insert(profiles)
      .values({
        orgId: memberOrgId,
        username: member.username,
        displayName: member.displayName,
        bio: member.bio,
        avatarHue: member.hue,
      })
      .onConflictDoNothing();

    await withOrgAdmin(memberOrgId, async (tx) => {
      for (const rating of member.ratings) {
        const itemId = idByTitle.get(rating.title);
        if (!itemId) continue;
        await tx
          .insert(itemRatings)
          .values({
            orgId: memberOrgId,
            itemId,
            elo: Math.round(1200 + rating.score * 60),
            matches: 8,
            wins: 6,
            losses: 2,
            reviewText: rating.text,
            reviewTags: rating.tags,
            spoiler: rating.spoiler ?? false,
            favoriteCharacter: rating.favoriteCharacter ?? null,
            favoriteTracks: rating.favoriteTracks ?? [],
          })
          .onConflictDoNothing();
      }
    });

    if (member.pod) {
      let podRow = (
        await db
          .select()
          .from(pods)
          .where(and(eq(pods.orgId, memberOrgId), eq(pods.slug, member.pod.slug)))
          .limit(1)
      )[0];
      if (!podRow) {
        podRow = (
          await db
            .insert(pods)
            .values({
              orgId: memberOrgId,
              title: member.pod.title,
              slug: member.pod.slug,
              description: member.pod.description,
              visibility: "public",
            })
            .returning()
        )[0]!;
      }
      const items = member.pod.items;
      for (let index = 0; index < items.length; index += 1) {
        const itemId = idByTitle.get(items[index]!);
        if (!itemId) continue;
        await db
          .insert(podItems)
          .values({ podId: podRow.id, itemId, position: index })
          .onConflictDoNothing();
      }
    }

    // The demo profile follows the seeded community so the home feed is alive.
    await db
      .insert(follows)
      .values({ followerOrgId: ownerOrgId, followeeOrgId: memberOrgId })
      .onConflictDoNothing();
    if (member.username === "cart") {
      await db
        .insert(follows)
        .values({ followerOrgId: memberOrgId, followeeOrgId: ownerOrgId })
        .onConflictDoNothing();
    }
  }
}

async function main(): Promise<void> {
  let rows = await db.select().from(orgs).where(eq(orgs.slug, SEED_SLUG)).limit(1);
  let org = rows[0];
  if (!org) {
    rows = await db
      .insert(orgs)
      .values({ name: "Demo Profile", slug: SEED_SLUG, planTier: "growth" })
      .returning();
    org = rows[0]!;
  }
  const orgId = org.id;

  let userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!userRows[0]) {
    userRows = await db
      .insert(users)
      .values({ email, name: "Demo Owner", passwordHash: hashPassword(password), emailVerifiedAt: new Date() })
      .returning();
  } else {
    await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, userRows[0].id));
  }
  const userId = userRows[0]!.id;

  const existingMembership = await db
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!existingMembership[0]) {
    await db.insert(memberships).values({ orgId, userId, role: "owner", status: "active" });
  }

  let locRows = await db.select().from(locations).where(eq(locations.orgId, orgId)).limit(1);
  let location = locRows[0];
  if (!location) {
    locRows = await db
      .insert(locations)
      .values({
        orgId,
        name: "Main Street",
        address: "120 Main St, Springfield",
        phone: "+15555550100",
        timezone: "America/Denver",
        hours: { mon_fri: "09:00-18:00", sat: "10:00-16:00" },
      })
      .returning();
    location = locRows[0]!;
  }
  const locationId = location.id;

  const existingContacts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.orgId, orgId));
  if ((existingContacts[0]?.n ?? 0) > 0) {
    console.log(`seed: org "${SEED_SLUG}" already has data; credentials refreshed only`);
  } else {
    await withOrgAdmin(orgId, async (tx) => {
      const people = [
        { name: "Ava Thompson", company: "Thompson Dental" },
        { name: "Marcus Lee", company: null },
        { name: "Priya Patel", company: "Patel & Co." },
        { name: "Jon Rivera", company: null },
        { name: "Hannah Cole", company: "Cole Fitness" },
        { name: "Sam Okafor", company: null },
      ];
      const inserted = await tx
        .insert(contacts)
        .values(people.map((p) => ({ orgId, name: p.name, company: p.company, source: "seed" })))
        .returning({ id: contacts.id });

      const google = (
        await tx
          .insert(reviewPlatforms)
          .values({ orgId, kind: "google", displayName: "Google", externalRef: "accounts/demo/locations/demo" })
          .returning()
      )[0]!;
      const facebook = (
        await tx
          .insert(reviewPlatforms)
          .values({ orgId, kind: "facebook", displayName: "Facebook", externalRef: "page/demo" })
          .returning()
      )[0]!;

      const now = Date.now();
      const day = 86_400_000;
      await tx.insert(reviews).values([
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-1",
          authorName: "Ava T.",
          rating: 5,
          body: "Fast, friendly, and they explained everything. Highly recommend.",
          reviewedAt: new Date(now - 2 * day),
          replyStatus: "posted",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-2",
          authorName: "Marcus L.",
          rating: 4,
          body: "Great service, small wait at check-in.",
          reviewedAt: new Date(now - 6 * day),
          replyStatus: "draft",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-3",
          authorName: "Priya P.",
          rating: 5,
          body: "Second time here and still excellent.",
          reviewedAt: new Date(now - 11 * day),
          replyStatus: "posted",
        },
        {
          orgId,
          locationId,
          platformId: facebook.id,
          externalId: "seed-f-1",
          authorName: "Hannah C.",
          rating: 3,
          body: "Good work but the quote changed mid-job.",
          reviewedAt: new Date(now - 14 * day),
          replyStatus: "draft",
        },
        {
          orgId,
          locationId,
          platformId: google.id,
          externalId: "seed-g-4",
          authorName: "Sam O.",
          rating: 5,
          body: "Handled my emergency same day.",
          reviewedAt: new Date(now - 20 * day),
          replyStatus: "posted",
        },
      ]);

      await tx.insert(reviewRequests).values([
        {
          orgId,
          contactId: inserted[0]!.id,
          locationId,
          channel: "sms",
          status: "reviewed",
          sentAt: new Date(now - 3 * day),
          clickedAt: new Date(now - 2 * day),
          reviewedAt: new Date(now - 2 * day),
          platformKind: "google",
        },
        {
          orgId,
          contactId: inserted[1]!.id,
          locationId,
          channel: "sms",
          status: "clicked",
          sentAt: new Date(now - 2 * day),
          clickedAt: new Date(now - day),
        },
        {
          orgId,
          contactId: inserted[2]!.id,
          locationId,
          channel: "sms",
          status: "sent",
          sentAt: new Date(now - day),
        },
      ]);
    });
  }

  // --- Phase 1 fixtures: channels, consent, inbox -------------------
  // Idempotent: each item is created only if missing, so seed can rerun.
  await withOrgAdmin(orgId, async (tx) => {
    let smsChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "sms")))
        .limit(1)
    )[0];
    if (!smsChannel) {
      smsChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "sms",
            provider: "mock",
            providerRef: "+15555550100",
            status: "active",
          })
          .returning()
      )[0]!;
    }

    let webchatChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "webchat")))
        .limit(1)
    )[0];
    if (!webchatChannel) {
      webchatChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "webchat",
            provider: "appolo",
            providerRef: "demo-webchat",
            status: "active",
          })
          .returning()
      )[0]!;
    }

    let emailChannel = (
      await tx
        .select()
        .from(channels)
        .where(and(eq(channels.orgId, orgId), eq(channels.kind, "email")))
        .limit(1)
    )[0];
    if (!emailChannel) {
      emailChannel = (
        await tx
          .insert(channels)
          .values({
            orgId,
            locationId,
            kind: "email",
            provider: "mock",
            providerRef: process.env.EMAIL_FROM ?? null,
            status: "active",
          })
          .returning()
      )[0]!;
    }

    const existingNumber = await tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.e164, "+15555550100"))
      .limit(1);
    if (!existingNumber[0]) {
      await tx.insert(phoneNumbers).values({
        orgId,
        e164: "+15555550100",
        providerSid: "PN_demo",
        capabilities: { sms: true, voice: false },
        a2pStatus: "registered",
        country: "US",
      });
    }

    const primaryContact = (
      await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
        .limit(1)
    )[0];

    if (primaryContact) {
      const existing = await tx
        .select({ kind: contactChannels.kind })
        .from(contactChannels)
        .where(eq(contactChannels.contactId, primaryContact.id));
      const kinds = new Set(existing.map((c) => c.kind));
      if (!kinds.has("phone")) {
        await tx.insert(contactChannels).values({
          orgId,
          contactId: primaryContact.id,
          kind: "phone",
          value: "+15555550111",
          normalizedValue: "+15555550111",
          isPrimary: true,
        });
      }
      if (!kinds.has("email")) {
        await tx.insert(contactChannels).values({
          orgId,
          contactId: primaryContact.id,
          kind: "email",
          value: "ava@thompsondental.test",
          normalizedValue: "ava@thompsondental.test",
        });
      }

      const granted = await tx
        .select({ id: consentRecords.id })
        .from(consentRecords)
        .where(and(eq(consentRecords.contactId, primaryContact.id), eq(consentRecords.channel, "sms")))
        .limit(1);
      if (!granted[0]) {
        await tx.insert(consentRecords).values({
          orgId,
          contactId: primaryContact.id,
          channel: "sms",
          status: "granted",
          source: "seed",
          evidence: { note: "seeded consent" },
        });
      }

      const existingConversation = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.contactId, primaryContact.id))
        .limit(1);
      if (!existingConversation[0]) {
        const conversation = (
          await tx
            .insert(conversations)
            .values({
              orgId,
              contactId: primaryContact.id,
              channelId: smsChannel.id,
              locationId,
              status: "open",
              unreadCount: 1,
              lastMessageAt: new Date(),
            })
            .returning()
        )[0]!;
        const now = Date.now();
        await tx.insert(messages).values([
          {
            orgId,
            conversationId: conversation.id,
            direction: "inbound",
            senderType: "contact",
            body: "Hi! Do you have any openings this week?",
            status: "received",
            sentAt: new Date(now - 3_600_000),
          },
          {
            orgId,
            conversationId: conversation.id,
            direction: "outbound",
            senderType: "user",
            senderId: userId,
            body: "Hi Ava! We have Thursday at 2pm open — want me to hold it for you?",
            status: "delivered",
            sentAt: new Date(now - 3_500_000),
          },
        ]);
      }
    }

    const existingReply = await tx
      .select({ id: savedReplies.id })
      .from(savedReplies)
      .where(eq(savedReplies.orgId, orgId))
      .limit(1);
    if (!existingReply[0]) {
      await tx.insert(savedReplies).values([
        {
          orgId,
          scope: "org",
          title: "Greeting",
          body: "Hi {{first_name}}! Thanks for reaching out to us. How can we help?",
        },
        {
          orgId,
          scope: "org",
          title: "Hours",
          body: "We're open Mon–Fri 9–6 and Sat 10–4. What time works best for you, {{first_name}}?",
        },
        {
          orgId,
          scope: "org",
          title: "Review ask",
          body: "Glad we could help! If you have a moment, a quick review would mean a lot to our team.",
        },
      ]);
    }

    void webchatChannel;
    void emailChannel;
  });

  // --- Phase 2 fixtures: review templates, public links, settings ---
  // Idempotent: safe to rerun against an already-seeded database.
  await withOrgAdmin(orgId, async (tx) => {
    const day = 86_400_000;

    const templateCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewTemplates)
      .where(eq(reviewTemplates.orgId, orgId));
    if ((templateCount[0]?.n ?? 0) === 0) {
      await tx.insert(reviewTemplates).values(
        DEFAULT_REVIEW_TEMPLATES.map((template) => ({
          orgId,
          name: template.name,
          channel: template.channel,
          subject: template.subject ?? null,
          body: template.body,
          isDefault: template.isDefault ?? false,
          variables: ["first_name", "business_name", "review_link"],
        })),
      );
    }

    // Demo platforms point at public review URLs so the landing page has real
    // outbound links. Live Google sync still needs a real token + resource name.
    const platformRows = await tx.select().from(reviewPlatforms).where(eq(reviewPlatforms.orgId, orgId));
    const demoPlatforms: { kind: "google" | "facebook"; displayName: string; url: string }[] = [
      { kind: "google", displayName: "Google", url: "https://search.google.com/local/writereview?placeid=appolo-demo" },
      { kind: "facebook", displayName: "Facebook", url: "https://www.facebook.com/appolo-demo/reviews" },
    ];
    for (const demo of demoPlatforms) {
      const existing = platformRows.find((row) => row.kind === demo.kind);
      if (!existing) {
        await tx.insert(reviewPlatforms).values({
          orgId,
          kind: demo.kind,
          displayName: demo.displayName,
          externalRef: demo.url,
        });
      } else if (!/^https?:\/\//i.test(existing.externalRef ?? "")) {
        await tx
          .update(reviewPlatforms)
          .set({ externalRef: demo.url })
          .where(eq(reviewPlatforms.id, existing.id));
      }
    }

    // A stable demo token so the public landing page is easy to open.
    const demoToken = "demo-review-token-0001";
    const existingToken = await tx
      .select({ id: reviewTokens.id })
      .from(reviewTokens)
      .where(eq(reviewTokens.tokenHash, sha256(demoToken)))
      .limit(1);
    if (!existingToken[0]) {
      const demoContact = (
        await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
          .limit(1)
      )[0];
      if (demoContact) {
        const request = (
          await tx
            .insert(reviewRequests)
            .values({
              orgId,
              contactId: demoContact.id,
              locationId,
              channel: "sms",
              status: "sent",
              sentAt: new Date(Date.now() - day),
              platformKind: "google",
            })
            .returning({ id: reviewRequests.id })
        )[0]!;
        await tx.insert(reviewTokens).values({
          orgId,
          tokenHash: sha256(demoToken),
          requestId: request.id,
          expiresAt: new Date(Date.now() + 30 * day),
        });
      }
    }

    // Seed one piece of private feedback for the dashboard (not tied to the
    // demo landing token, so that form stays usable).
    const feedbackCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(privateFeedback)
      .where(eq(privateFeedback.orgId, orgId));
    if ((feedbackCount[0]?.n ?? 0) === 0) {
      const marcus = (
        await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Marcus Lee")))
          .limit(1)
      )[0];
      await tx.insert(privateFeedback).values({
        orgId,
        contactId: marcus?.id ?? null,
        rating: 3,
        body: "Service was good but the quote changed at pickup. Would appreciate a heads-up next time.",
        status: "new",
      });
    }

    // Default review-request policy, only if the org has not set one yet.
    const [orgSettingsRow] = await tx
      .select({ settings: orgs.settings })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    const settings = { ...((orgSettingsRow?.settings ?? {}) as Record<string, unknown>) };
    if (!settings.reviewRequests) {
      settings.reviewRequests = {
        quietHours: { enabled: true, start: "21:00", end: "08:00" },
        dailyCap: 200,
        timezone: "America/Denver",
        cooldownDays: 90,
        defaultPlatformKind: "google",
        followUp: {
          enabled: true,
          days: 3,
          max: 1,
          body: "Hi {{first_name}}, just a gentle reminder — if you have a moment, a quick review for {{business_name}} would really help us out: {{review_link}}",
        },
      };
      await tx.update(orgs).set({ settings }).where(eq(orgs.id, orgId));
    }
  });

  // --- Phase 3 fixtures: widget, keyword automation, draft campaign ---
  // Idempotent: each item is created only if its table is empty for the org.
  await withOrgAdmin(orgId, async (tx) => {
    const widgetCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewWidgets)
      .where(eq(reviewWidgets.orgId, orgId));
    if ((widgetCount[0]?.n ?? 0) === 0) {
      await tx.insert(reviewWidgets).values({
        orgId,
        publicKey: "rw_demo000000000000000000",
        config: {
          headline: "What our customers say",
          theme: "dark",
          layout: "list",
          minRating: 4,
          limit: 6,
          showRating: true,
        },
      });
    }

    // A demo tag so tag-segment campaigns have something to target.
    const primaryContact = (
      await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.name, "Ava Thompson")))
        .limit(1)
    )[0];
    if (primaryContact) {
      let vipTag = (
        await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.orgId, orgId), eq(tags.name, "vip")))
          .limit(1)
      )[0];
      if (!vipTag) {
        vipTag = (await tx.insert(tags).values({ orgId, name: "vip", color: "#f59e0b" }).returning({ id: tags.id }))[0]!;
      }
      await tx
        .insert(contactTags)
        .values({ orgId, contactId: primaryContact.id, tagId: vipTag.id })
        .onConflictDoNothing();
    }

    const automationCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(automations)
      .where(eq(automations.orgId, orgId));
    if ((automationCount[0]?.n ?? 0) === 0) {
      const [automation] = await tx
        .insert(automations)
        .values({
          orgId,
          name: "Hours question",
          trigger: "keyword",
          conditions: { keywords: ["hours", "open", "closing"], matchType: "contains", channels: [] },
          enabled: true,
        })
        .returning({ id: automations.id });
      await tx.insert(automationSteps).values({
        orgId,
        automationId: automation!.id,
        order: 1,
        kind: "auto_reply",
        config: {
          body: "Hi {{first_name}}, we're open Mon-Fri 9-6 and Sat 10-4. Reply here and we'll help!",
        },
      });
    }

    const campaignCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(eq(campaigns.orgId, orgId));
    if ((campaignCount[0]?.n ?? 0) === 0) {
      const contactRows = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.orgId, orgId))
        .limit(3);
      if (contactRows.length > 0) {
        const [campaign] = await tx
          .insert(campaigns)
          .values({
            orgId,
            name: "Thank-you broadcast",
            channel: "sms",
            segment: {
              type: "all",
              body: "Hi {{first_name}}, thanks for being a customer of {{business_name}}!",
            },
            status: "draft",
          })
          .returning({ id: campaigns.id });
        await tx.insert(campaignRecipients).values(
          contactRows.map((contact) => ({
            orgId,
            campaignId: campaign!.id,
            contactId: contact.id,
            status: "pending",
          })),
        );
      }
    }
  });

  // --- Phase 4 fixtures: AI employee (disabled by default) + knowledge base ---
  await withOrgAdmin(orgId, async (tx) => {
    const agentCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiAgents)
      .where(eq(aiAgents.orgId, orgId));
    if ((agentCount[0]?.n ?? 0) === 0) {
      await tx.insert(aiAgents).values({
        orgId,
        name: "AI Employee",
        enabled: false,
        voiceProfile: {
          enabled: false,
          greeting: "Thanks for reaching out!",
          escalationKeywords: ["human", "manager", "refund", "complaint"],
          blockedTopics: ["medical advice", "legal advice"],
          confidenceThreshold: 0.34,
        },
      });
    }

    const docCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiKnowledgeDocs)
      .where(eq(aiKnowledgeDocs.orgId, orgId));
    if ((docCount[0]?.n ?? 0) === 0) {
      const docs = [
        {
          title: "Business hours",
          content: "We are open Monday to Friday, 9am to 6pm, and Saturday 10am to 4pm. We are closed on Sundays.",
        },
        {
          title: "Location and parking",
          content: "We are at 100 Main Street. Free parking is available behind the building, enter from Oak Avenue.",
        },
      ];
      for (const doc of docs) {
        const [created] = await tx
          .insert(aiKnowledgeDocs)
          .values({
            orgId,
            title: doc.title,
            sourceType: "text",
            status: "ready",
            checksum: Buffer.from(doc.content).toString("base64url").slice(0, 32),
          })
          .returning({ id: aiKnowledgeDocs.id });
        await tx.insert(aiKnowledgeChunks).values({
          orgId,
          docId: created!.id,
          content: doc.content,
          tokenCount: Math.ceil(doc.content.length / 4),
        });
      }
    }
  });

  // --- Media catalog (shared) + demo taste profile (org-scoped) ---
  await seedMedia(orgId);
  await seedCommunity(orgId, "Demo Profile");

  // --- Podiums-parity demo data: pinned review, manual mode, watchlist,
  //     history, notifications, search history ---------------------------
  await withOrgAdmin(orgId, async (tx) => {
    const profileRow = (await tx.select().from(profiles).where(eq(profiles.orgId, orgId)).limit(1))[0];
    if (!profileRow) return;

    // manual mode + connected services + pinned review
    const breakingBadRating = (
      await tx
        .select({ id: itemRatings.id })
        .from(itemRatings)
        .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
        .where(and(eq(itemRatings.orgId, orgId), eq(catalogItems.title, "Breaking Bad")))
        .limit(1)
    )[0];
    await tx
      .update(profiles)
      .set({
        manualMode: true,
        spotifyConnected: true,
        appleMusicConnected: false,
        language: "en",
        pinnedRatingId: breakingBadRating?.id ?? null,
        bio: "Building my podium.",
      })
      .where(eq(profiles.orgId, orgId));

    // watchlist
    const watchTitles = ["Elden Ring", "Disco Elysium", "The Legend of Zelda: Breath of the Wild"];
    const allItems = await tx.select({ id: catalogItems.id, title: catalogItems.title }).from(catalogItems);
    const idByTitle = new Map(allItems.map((row) => [row.title, row.id]));
    for (const title of watchTitles) {
      const itemId = idByTitle.get(title);
      if (!itemId) continue;
      await tx.insert(watchlist).values({ orgId, itemId }).onConflictDoNothing();
    }

    // rating history events
    const ratedRows = await tx
      .select({ itemId: itemRatings.itemId, elo: itemRatings.elo })
      .from(itemRatings)
      .where(eq(itemRatings.orgId, orgId))
      .limit(5);
    for (const row of ratedRows) {
      await tx.insert(ratingEvents).values({ orgId, itemId: row.itemId, kind: "rated", detail: "Rated" }).onConflictDoNothing();
    }

    // notifications from community
    const cartOrg = (await tx.select().from(orgs).where(eq(orgs.slug, "cart")).limit(1))[0];
    if (cartOrg) {
      const cartRating = (
        await tx
          .select({ id: itemRatings.id, itemId: itemRatings.itemId })
          .from(itemRatings)
          .where(eq(itemRatings.orgId, cartOrg.id))
          .limit(1)
      )[0];
      if (cartRating) {
        await tx.insert(socialNotifications).values({
          orgId,
          actorOrgId: cartOrg.id,
          kind: "follow",
          body: "cart started following you",
        });
        await tx.insert(socialNotifications).values({
          orgId,
          actorOrgId: cartOrg.id,
          kind: "reaction",
          itemId: cartRating.itemId,
          ratingId: cartRating.id,
          body: "🔥",
        });
      }
    }

    // search history
    for (const q of ["sci-fi", "Hollow Knight", "Frank Ocean"]) {
      await tx.insert(searchHistory).values({ orgId, query: q }).onConflictDoNothing();
    }
  });

  console.log("");
  console.log("  seed complete");
  console.log("  ----------------------------------------");
  console.log(`  email    : ${email}`);
  console.log(`  password : ${password}`);
  console.log(`  org      : ${org.name} (${SEED_SLUG})`);
  console.log("");
}

main()
  .then(async () => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
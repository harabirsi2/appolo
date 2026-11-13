/**
 * Catalog expansion, part 1: movies, TV and games.
 * One row per title: Title|Creator|Year|genre,genre
 * Metadata is factual (title, director/studio, year); no provider text is copied.
 */

export const EXPANSION_MOVIES = `
The Shawshank Redemption|Frank Darabont|1994|drama,crime
The Godfather Part II|Francis Ford Coppola|1974|crime,drama
Schindler's List|Steven Spielberg|1993|drama,historical
12 Angry Men|Sidney Lumet|1957|drama
The Lord of the Rings: The Fellowship of the Ring|Peter Jackson|2001|fantasy,adventure
The Lord of the Rings: The Return of the King|Peter Jackson|2003|fantasy,adventure
Fight Club|David Fincher|1999|drama,thriller
Forrest Gump|Robert Zemeckis|1994|drama
Inception|Christopher Nolan|2010|sci-fi,thriller
The Matrix|Lana Wachowski|1999|sci-fi,action
Good Will Hunting|Gus Van Sant|1997|drama
Saving Private Ryan|Steven Spielberg|1998|war,drama
The Silence of the Lambs|Jonathan Demme|1991|thriller,crime
Se7en|David Fincher|1995|thriller,crime
Léon: The Professional|Luc Besson|1994|action,thriller
The Usual Suspects|Bryan Singer|1995|crime,thriller
Life Is Beautiful|Roberto Benigni|1997|drama,comedy
Cinema Paradiso|Giuseppe Tornatore|1988|drama,romance
Grave of the Fireflies|Isao Takahata|1988|animation,drama
My Neighbor Totoro|Hayao Miyazaki|1988|animation,fantasy
Princess Mononoke|Hayao Miyazaki|1997|animation,fantasy
Howl's Moving Castle|Hayao Miyazaki|2004|animation,fantasy
Your Name|Makoto Shinkai|2016|animation,romance
Akira|Katsuhiro Otomo|1988|animation,sci-fi
Perfect Blue|Satoshi Kon|1997|animation,thriller
Oldboy|Park Chan-wook|2003|thriller,drama
Memories of Murder|Bong Joon-ho|2003|crime,thriller
The Handmaiden|Park Chan-wook|2016|thriller,romance
Decision to Leave|Park Chan-wook|2022|romance,mystery
Burning|Lee Chang-dong|2018|drama,mystery
Shoplifters|Hirokazu Kore-eda|2018|drama
Drive My Car|Ryusuke Hamaguchi|2021|drama
Tokyo Story|Yasujiro Ozu|1953|drama
Rashomon|Akira Kurosawa|1950|drama,crime
Yojimbo|Akira Kurosawa|1961|action,drama
Ikiru|Akira Kurosawa|1952|drama
Harakiri|Masaki Kobayashi|1962|drama
The Seventh Seal|Ingmar Bergman|1957|drama,fantasy
Persona|Ingmar Bergman|1966|drama
Wild Strawberries|Ingmar Bergman|1957|drama
8½|Federico Fellini|1963|drama
La Dolce Vita|Federico Fellini|1960|drama
Bicycle Thieves|Vittorio De Sica|1948|drama
The 400 Blows|François Truffaut|1959|drama
Breathless|Jean-Luc Godard|1960|crime,drama
Cleo from 5 to 7|Agnès Varda|1962|drama
The Umbrellas of Cherbourg|Jacques Demy|1964|romance,musical
Au Hasard Balthazar|Robert Bresson|1966|drama
Stalker|Andrei Tarkovsky|1979|sci-fi,drama
Solaris|Andrei Tarkovsky|1972|sci-fi,drama
The Mirror|Andrei Tarkovsky|1975|drama
Andrei Rublev|Andrei Tarkovsky|1966|drama,historical
Come and See|Elem Klimov|1985|war,drama
The Cranes Are Flying|Mikhail Kalatozov|1957|war,drama
La Haine|Mathieu Kassovitz|1995|drama,crime
Amélie|Jean-Pierre Jeunet|2001|romance,comedy
The Intouchables|Olivier Nakache|2011|comedy,drama
Pan's Labyrinth|Guillermo del Toro|2006|fantasy,drama
The Shape of Water|Guillermo del Toro|2017|fantasy,romance
Roma|Alfonso Cuarón|2018|drama
Y Tu Mamá También|Alfonso Cuarón|2001|drama
Children of Men|Alfonso Cuarón|2006|sci-fi,thriller
City Lights|Charlie Chaplin|1931|comedy,romance
Modern Times|Charlie Chaplin|1936|comedy
The Great Dictator|Charlie Chaplin|1940|comedy,drama
Sunset Boulevard|Billy Wilder|1950|drama
Some Like It Hot|Billy Wilder|1959|comedy
Double Indemnity|Billy Wilder|1944|crime,thriller
Rear Window|Alfred Hitchcock|1954|thriller,mystery
Vertigo|Alfred Hitchcock|1958|thriller,romance
Psycho|Alfred Hitchcock|1960|horror,thriller
North by Northwest|Alfred Hitchcock|1959|thriller
Citizen Kane|Orson Welles|1941|drama
Touch of Evil|Orson Welles|1958|crime,thriller
The Third Man|Carol Reed|1949|thriller,mystery
Chinatown|Roman Polanski|1974|crime,mystery
Taxi Driver|Martin Scorsese|1976|drama,crime
Raging Bull|Martin Scorsese|1980|drama,sport
After Hours|Martin Scorsese|1985|comedy,thriller
The Departed|Martin Scorsese|2006|crime,thriller
The Irishman|Martin Scorsese|2019|crime,drama
Apocalypse Now|Francis Ford Coppola|1979|war,drama
The Conversation|Francis Ford Coppola|1974|thriller,mystery
Dog Day Afternoon|Sidney Lumet|1975|crime,drama
Network|Sidney Lumet|1976|drama
12 Years a Slave|Steve McQueen|2013|drama,historical
Selma|Ava DuVernay|2014|drama,historical
Fences|Denzel Washington|2016|drama
BlacKkKlansman|Spike Lee|2018|drama,crime
Malcolm X|Spike Lee|1992|drama,historical
Inside Man|Spike Lee|2006|crime,thriller
Uncut Gems|Josh Safdie|2019|thriller,crime
Good Time|Benny Safdie|2017|thriller,crime
The Social Network|David Fincher|2010|drama
Gone Girl|David Fincher|2014|thriller,mystery
Zodiac|David Fincher|2007|thriller,crime
Memento|Christopher Nolan|2000|thriller,mystery
Oppenheimer|Christopher Nolan|2023|drama,historical
Dunkirk|Christopher Nolan|2017|war,thriller
Tenet|Christopher Nolan|2020|sci-fi,action
Dune: Part Two|Denis Villeneuve|2024|sci-fi,adventure
Blade Runner 2049|Denis Villeneuve|2017|sci-fi,drama
Sicario|Denis Villeneuve|2015|thriller,crime
Prisoners|Denis Villeneuve|2013|thriller,crime
Nightcrawler|Dan Gilroy|2014|thriller,crime
Ex Machina|Alex Garland|2014|sci-fi,thriller
Annihilation|Alex Garland|2018|sci-fi,horror
Her|Spike Jonze|2013|sci-fi,romance
Lady Bird|Greta Gerwig|2017|drama,comedy
Little Women|Greta Gerwig|2019|drama,romance
Barbie|Greta Gerwig|2023|comedy,fantasy
Past Lives|Celine Song|2023|romance,drama
Aftersun|Charlotte Wells|2022|drama
The Zone of Interest|Jonathan Glazer|2023|drama,historical
Anatomy of a Fall|Justine Triet|2023|drama,thriller
Another Round|Thomas Vinterberg|2020|drama,comedy
The Hunt|Thomas Vinterberg|2012|drama
Force Majeure|Ruben Östlund|2014|drama,comedy
The Square|Ruben Östlund|2017|drama,comedy
Triangle of Sadness|Ruben Östlund|2022|comedy,drama
The Worst Person in the World|Joachim Trier|2021|drama,romance
Oslo, August 31st|Joachim Trier|2011|drama
Toni Erdmann|Maren Ade|2016|comedy,drama
Son of Saul|László Nemes|2015|drama,war
Ida|Paweł Pawlikowski|2013|drama
Cold War|Paweł Pawlikowski|2018|drama,romance
The Lives of Others|Florian Henckel von Donnersmarck|2006|drama,thriller
Downfall|Oliver Hirschbiegel|2004|war,drama
Run Lola Run|Tom Tykwer|1998|thriller
Wings of Desire|Wim Wenders|1987|fantasy,drama
Paris, Texas|Wim Wenders|1984|drama
Happy Together|Wong Kar-wai|1997|romance,drama
Chungking Express|Wong Kar-wai|1994|romance,drama
Fallen Angels|Wong Kar-wai|1995|crime,romance
Hero|Zhang Yimou|2002|action,drama
Raise the Red Lantern|Zhang Yimou|1991|drama
Farewell My Concubine|Chen Kaige|1993|drama,romance
Crouching Tiger, Hidden Dragon|Ang Lee|2000|action,fantasy
Brokeback Mountain|Ang Lee|2005|romance,drama
Eat Drink Man Woman|Ang Lee|1994|drama,comedy
A Separation|Asghar Farhadi|2011|drama
About Elly|Asghar Farhadi|2009|drama,mystery
The Salesman|Asghar Farhadi|2016|drama
Capernaum|Nadine Labaki|2018|drama
The Battle of Algiers|Gillo Pontecorvo|1966|war,historical
The Act of Killing|Joshua Oppenheimer|2012|documentary
Man on Wire|James Marsh|2008|documentary
Free Solo|Elizabeth Chai Vasarhelyi|2018|documentary
Won't You Be My Neighbor?|Morgan Neville|2018|documentary
Jiro Dreams of Sushi|David Gelb|2011|documentary
Grizzly Man|Werner Herzog|2005|documentary
Aguirre, the Wrath of God|Werner Herzog|1972|adventure,drama
Fitzcarraldo|Werner Herzog|1982|adventure,drama
Nosferatu|F. W. Murnau|1922|horror
Metropolis|Fritz Lang|1927|sci-fi,drama
M|Fritz Lang|1931|thriller,crime
The Cabinet of Dr. Caligari|Robert Wiene|1920|horror
Battleship Potemkin|Sergei Eisenstein|1925|drama,historical
The Passion of Joan of Arc|Carl Theodor Dreyer|1928|drama,historical
The Rules of the Game|Jean Renoir|1939|drama,comedy
Grand Illusion|Jean Renoir|1937|war,drama
The Wages of Fear|Henri-Georges Clouzot|1953|thriller,adventure
Rififi|Jules Dassin|1955|crime,thriller
Le Samouraï|Jean-Pierre Melville|1967|crime,thriller
Army of Shadows|Jean-Pierre Melville|1969|war,thriller
The Red Shoes|Michael Powell|1948|drama,musical
Black Narcissus|Michael Powell|1947|drama
Brief Encounter|David Lean|1945|romance,drama
Lawrence of Arabia|David Lean|1962|adventure,historical
The Bridge on the River Kwai|David Lean|1957|war,drama
The Apartment|Billy Wilder|1960|comedy,romance
All About Eve|Joseph L. Mankiewicz|1950|drama
A Streetcar Named Desire|Elia Kazan|1951|drama
On the Waterfront|Elia Kazan|1954|drama,crime
Rebel Without a Cause|Nicholas Ray|1955|drama
Singin' in the Rain|Stanley Donen|1952|musical,comedy
The Searchers|John Ford|1956|western
Once Upon a Time in the West|Sergio Leone|1968|western
The Good, the Bad and the Ugly|Sergio Leone|1966|western
A Fistful of Dollars|Sergio Leone|1964|western
Unforgiven|Clint Eastwood|1992|western,drama
The Outlaw Josey Wales|Clint Eastwood|1976|western
The Big Lebowski|Joel Coen|1998|comedy,crime
Fargo|Joel Coen|1996|crime,thriller
Barton Fink|Joel Coen|1991|drama,comedy
A Serious Man|Joel Coen|2009|drama,comedy
Inside Llewyn Davis|Joel Coen|2013|drama,music
The Truman Show|Peter Weir|1998|drama,sci-fi
Dead Poets Society|Peter Weir|1989|drama
Master and Commander|Peter Weir|2003|adventure,war
Groundhog Day|Harold Ramis|1993|comedy,fantasy
Ghostbusters|Ivan Reitman|1984|comedy,fantasy
Back to the Future|Robert Zemeckis|1985|sci-fi,comedy
Who Framed Roger Rabbit|Robert Zemeckis|1988|comedy,animation
Jurassic Park|Steven Spielberg|1993|adventure,sci-fi
Raiders of the Lost Ark|Steven Spielberg|1981|adventure,action
Jaws|Steven Spielberg|1975|thriller
E.T. the Extra-Terrestrial|Steven Spielberg|1982|sci-fi,family
Close Encounters of the Third Kind|Steven Spielberg|1977|sci-fi
Minority Report|Steven Spielberg|2002|sci-fi,thriller
Catch Me If You Can|Steven Spielberg|2002|drama,crime
The Color Purple|Steven Spielberg|1985|drama
A.I. Artificial Intelligence|Steven Spielberg|2001|sci-fi,drama
The Shining|Stanley Kubrick|1980|horror
Full Metal Jacket|Stanley Kubrick|1987|war,drama
A Clockwork Orange|Stanley Kubrick|1971|sci-fi,crime
Barry Lyndon|Stanley Kubrick|1975|drama,historical
Dr. Strangelove|Stanley Kubrick|1964|comedy,war
Paths of Glory|Stanley Kubrick|1957|war,drama
Eyes Wide Shut|Stanley Kubrick|1999|drama,mystery
Alien|Ridley Scott|1979|horror,sci-fi
Blade Runner|Ridley Scott|1982|sci-fi,thriller
Thelma & Louise|Ridley Scott|1991|drama,crime
Gladiator|Ridley Scott|2000|action,historical
The Martian|Ridley Scott|2015|sci-fi,adventure
The Terminator|James Cameron|1984|sci-fi,action
Terminator 2: Judgment Day|James Cameron|1991|sci-fi,action
Aliens|James Cameron|1986|sci-fi,action
Titanic|James Cameron|1997|romance,drama
Avatar|James Cameron|2009|sci-fi,adventure
Die Hard|John McTiernan|1988|action,thriller
Heat|Michael Mann|1995|crime,thriller
Collateral|Michael Mann|2004|thriller,crime
The Insider|Michael Mann|1999|drama
L.A. Confidential|Curtis Hanson|1997|crime,mystery
The Big Sleep|Howard Hawks|1946|crime,mystery
His Girl Friday|Howard Hawks|1940|comedy,romance
Bringing Up Baby|Howard Hawks|1938|comedy,romance
It Happened One Night|Frank Capra|1934|comedy,romance
Mr. Smith Goes to Washington|Frank Capra|1939|drama
It's a Wonderful Life|Frank Capra|1946|drama,fantasy
Anatomy of a Murder|Otto Preminger|1959|crime,drama
In a Lonely Place|Nicholas Ray|1950|crime,romance
Sweet Smell of Success|Alexander Mackendrick|1957|drama,crime
Ace in the Hole|Billy Wilder|1951|drama,crime
The Night of the Hunter|Charles Laughton|1955|thriller,crime
Out of the Past|Jacques Tourneur|1947|crime,mystery
The Maltese Falcon|John Huston|1941|crime,mystery
The Treasure of the Sierra Madre|John Huston|1948|adventure,drama
Key Largo|John Huston|1948|crime,thriller
The African Queen|John Huston|1951|adventure,romance
Roman Holiday|William Wyler|1953|romance,comedy
The Best Years of Our Lives|William Wyler|1946|drama,war
Ben-Hur|William Wyler|1959|historical,adventure
Spartacus|Stanley Kubrick|1960|historical,adventure
The Lion in Winter|Anthony Harvey|1968|drama,historical
A Man for All Seasons|Fred Zinnemann|1966|drama,historical
High Noon|Fred Zinnemann|1952|western
From Here to Eternity|Fred Zinnemann|1953|drama,war
The Wild Bunch|Sam Peckinpah|1969|western,action
Bring Me the Head of Alfredo Garcia|Sam Peckinpah|1974|crime,drama
Straw Dogs|Sam Peckinpah|1971|thriller,drama
The Last Picture Show|Peter Bogdanovich|1971|drama
Paper Moon|Peter Bogdanovich|1973|comedy,drama
Nashville|Robert Altman|1975|drama,music
MASH|Robert Altman|1970|comedy,war
The Long Goodbye|Robert Altman|1973|crime,mystery
McCabe & Mrs. Miller|Robert Altman|1971|western,drama
Short Cuts|Robert Altman|1993|drama
Three Women|Robert Altman|1977|drama
Days of Heaven|Terrence Malick|1978|drama,romance
Badlands|Terrence Malick|1973|crime,drama
The Thin Red Line|Terrence Malick|1998|war,drama
The Tree of Life|Terrence Malick|2011|drama
A Hidden Life|Terrence Malick|2019|drama,war
Blue Velvet|David Lynch|1986|thriller,mystery
Mulholland Drive|David Lynch|2001|thriller,mystery
Eraserhead|David Lynch|1977|horror
The Elephant Man|David Lynch|1980|drama
Lost Highway|David Lynch|1997|thriller
Wild at Heart|David Lynch|1990|crime,romance
Inland Empire|David Lynch|2006|thriller
The Straight Story|David Lynch|1999|drama
Eyes Without a Face|Georges Franju|1960|horror
Diabolique|Henri-Georges Clouzot|1955|thriller,mystery
The Wicker Man|Robin Hardy|1973|horror,mystery
Don't Look Now|Nicolas Roeg|1973|horror,thriller
The Innocents|Jack Clayton|1961|horror
Rosemary's Baby|Roman Polanski|1968|horror
Repulsion|Roman Polanski|1965|horror,thriller
The Tenant|Roman Polanski|1976|thriller
The Fearless Vampire Killers|Roman Polanski|1967|comedy,horror
The Exorcist|William Friedkin|1973|horror
The French Connection|William Friedkin|1971|crime,thriller
Sorcerer|William Friedkin|1977|thriller,adventure
Bug|William Friedkin|2006|thriller,horror
Killer Joe|William Friedkin|2011|crime,thriller
To Live and Die in L.A.|William Friedkin|1985|crime,thriller
Cruising|William Friedkin|1980|crime,thriller
The Boys in the Band|William Friedkin|1970|drama
The Twilight Samurai|Yoji Yamada|2002|drama
Departures|Yoichi Sai|2008|drama
Nobody Knows|Hirokazu Kore-eda|2004|drama
Like Father, Like Son|Hirokazu Kore-eda|2013|drama
After Life|Hirokazu Kore-eda|1998|drama,fantasy
Still Walking|Hirokazu Kore-eda|2008|drama
The Flavor of Green Tea over Rice|Yasujiro Ozu|1952|drama
Late Spring|Yasujiro Ozu|1949|drama
Early Summer|Yasujiro Ozu|1951|drama
An Autumn Afternoon|Yasujiro Ozu|1962|drama
Floating Weeds|Yasujiro Ozu|1959|drama
Good Morning|Yasujiro Ozu|1959|comedy
Equinox Flower|Yasujiro Ozu|1958|drama
The Only Son|Yasujiro Ozu|1936|drama
There Was a Father|Yasujiro Ozu|1942|drama
A Story of Floating Weeds|Yasujiro Ozu|1934|drama
The End of Summer|Yasujiro Ozu|1961|drama
The Bad Sleep Well|Akira Kurosawa|1960|crime,drama
High and Low|Akira Kurosawa|1963|crime,thriller
Red Beard|Akira Kurosawa|1965|drama
Dodes'ka-den|Akira Kurosawa|1970|drama
Ran|Akira Kurosawa|1985|drama,historical
Kagemusha|Akira Kurosawa|1980|drama,historical
Dreams|Akira Kurosawa|1990|drama,fantasy
Sanjuro|Akira Kurosawa|1962|action,drama
Throne of Blood|Akira Kurosawa|1957|drama,historical
The Hidden Fortress|Akira Kurosawa|1958|adventure,drama
Stray Dog|Akira Kurosawa|1949|crime,drama
Drunken Angel|Akira Kurosawa|1948|crime,drama
Scandal|Akira Kurosawa|1950|drama
The Idiot|Akira Kurosawa|1951|drama
I Live in Fear|Akira Kurosawa|1955|drama
`.trim().split("\n");

export const EXPANSION_TV = `
The Sopranos|David Chase|1999|crime,drama
The Wire|David Simon|2002|crime,drama
Mad Men|Matthew Weiner|2007|drama
Better Call Saul|Vince Gilligan|2015|crime,drama
Succession|Jesse Armstrong|2018|drama,comedy
Chernobyl|Craig Mazin|2019|drama,historical
True Detective|Nic Pizzolatto|2014|crime,thriller
Fargo|Noah Hawley|2014|crime,thriller
Fleabag|Phoebe Waller-Bridge|2016|comedy,drama
Killing Eve|Phoebe Waller-Bridge|2018|thriller,drama
Barry|Alec Berg|2018|comedy,crime
Veep|Armando Iannucci|2012|comedy
The Thick of It|Armando Iannucci|2005|comedy
Peep Show|Sam Bain|2003|comedy
The IT Crowd|Graham Linehan|2006|comedy
Black Mirror|Charlie Brooker|2011|sci-fi,thriller
Utopia|Dennis Kelly|2013|thriller,sci-fi
Broadchurch|Chris Chibnall|2013|crime,drama
Happy Valley|Sally Wainwright|2014|crime,drama
Line of Duty|Jed Mercurio|2012|crime,thriller
Bodyguard|Jed Mercurio|2018|thriller
Luther|Neil Cross|2010|crime,thriller
Sherlock|Steven Moffat|2010|crime,mystery
Doctor Who|Sydney Newman|2005|sci-fi,adventure
Downton Abbey|Julian Fellowes|2010|drama,historical
Call the Midwife|Heidi Thomas|2012|drama,historical
The Great British Bake Off|Love Productions|2010|reality
Planet Earth|David Attenborough|2006|documentary,nature
Planet Earth II|David Attenborough|2016|documentary,nature
Blue Planet II|David Attenborough|2017|documentary,nature
Our Planet|David Attenborough|2019|documentary,nature
Cosmos: A Spacetime Odyssey|Neil deGrasse Tyson|2014|documentary,science
The Last Dance|Jason Hehir|2020|documentary,sport
Making a Murderer|Laura Ricciardi|2015|documentary,crime
The Jinx|Andrew Jarecki|2015|documentary,crime
Wild Wild Country|Maclain Way|2018|documentary
Narcos|Chris Brancato|2015|crime,drama
Money Heist|Álex Pina|2017|crime,thriller
Dark|Baran bo Odar|2017|sci-fi,mystery
Deutschland 83|Anna Winger|2015|thriller,historical
Babylon Berlin|Tom Tykwer|2017|crime,historical
Borgen|Adam Price|2010|drama,political
The Bridge|Hans Rosenfeldt|2011|crime,thriller
Trapped|Baltasar Kormákur|2015|crime,mystery
Skam|Julie Andem|2015|drama
Sex Education|Laurie Nunn|2019|comedy,drama
After Life|Ricky Gervais|2019|comedy,drama
Extras|Ricky Gervais|2005|comedy
The Office|Ricky Gervais|2001|comedy
The Office|Greg Daniels|2005|comedy
Parks and Recreation|Greg Daniels|2009|comedy
Brooklyn Nine-Nine|Dan Goor|2013|comedy
Community|Dan Harmon|2009|comedy
30 Rock|Tina Fey|2006|comedy
Arrested Development|Mitchell Hurwitz|2003|comedy
Scrubs|Bill Lawrence|2001|comedy,drama
Freaks and Geeks|Paul Feig|1999|comedy,drama
My So-Called Life|Winnie Holzman|1994|drama
Gilmore Girls|Amy Sherman-Palladino|2000|drama,comedy
Buffy the Vampire Slayer|Joss Whedon|1997|fantasy,drama
The X-Files|Chris Carter|1993|sci-fi,mystery
Twin Peaks|David Lynch|1990|mystery,drama
Lost|J. J. Abrams|2004|sci-fi,mystery
Fringe|J. J. Abrams|2008|sci-fi,mystery
The Leftovers|Damon Lindelof|2014|drama,mystery
Watchmen|Damon Lindelof|2019|superhero,drama
Westworld|Jonathan Nolan|2016|sci-fi,drama
Silo|Graham Yost|2023|sci-fi,mystery
Foundation|David S. Goyer|2021|sci-fi
The Expanse|Mark Fergus|2015|sci-fi
Battlestar Galactica|Ronald D. Moore|2004|sci-fi
Star Trek: The Next Generation|Gene Roddenberry|1987|sci-fi
Star Trek: Deep Space Nine|Rick Berman|1993|sci-fi
The Mandalorian|Jon Favreau|2019|sci-fi,adventure
Andor|Tony Gilroy|2022|sci-fi,drama
Arcane|Christian Linke|2021|animation,fantasy
Avatar: The Last Airbender|Michael Dante DiMartino|2005|animation,adventure
Over the Garden Wall|Patrick McHale|2014|animation,fantasy
Adventure Time|Pendleton Ward|2010|animation,comedy
Gravity Falls|Alex Hirsch|2012|animation,mystery
BoJack Horseman|Raphael Bob-Waksberg|2014|animation,comedy
Rick and Morty|Justin Roiland|2013|animation,sci-fi
Futurama|Matt Groening|1999|animation,comedy
The Simpsons|Matt Groening|1989|animation,comedy
South Park|Trey Parker|1997|animation,comedy
Bob's Burgers|Loren Bouchard|2011|animation,comedy
Bluey|Joe Brumm|2018|animation,family
Ted Lasso|Bill Lawrence|2020|comedy,drama
Shrinking|Bill Lawrence|2023|comedy,drama
Hacks|Lucia Aniello|2021|comedy,drama
Only Murders in the Building|Steve Martin|2021|comedy,mystery
Reservation Dogs|Sterlin Harjo|2021|comedy,drama
Atlanta|Donald Glover|2016|comedy,drama
Insecure|Issa Rae|2016|comedy,drama
Euphoria|Sam Levinson|2019|drama
Normal People|Lenny Abrahamson|2020|romance,drama
The White Lotus|Mike White|2021|comedy,drama
Big Little Lies|David E. Kelley|2017|drama,mystery
Sharp Objects|Marti Noxon|2018|drama,mystery
Mare of Easttown|Brad Ingelsby|2021|crime,drama
Unbelievable|Susannah Grant|2019|crime,drama
Mindhunter|Joe Penhall|2017|crime,drama
Hannibal|Bryan Fuller|2013|thriller,horror
Dexter|James Manos Jr.|2006|crime,thriller
Six Feet Under|Alan Ball|2001|drama,comedy
Oz|Tom Fontana|1997|crime,drama
Deadwood|David Milch|2004|western,drama
Boardwalk Empire|Terence Winter|2010|crime,historical
Rome|Bruno Heller|2005|historical,drama
The Last Kingdom|Bernard Cornwell|2015|historical,action
The Crown|Peter Morgan|2016|drama,historical
Wolf Hall|Peter Kosminsky|2015|drama,historical
I, Claudius|Jack Pulman|1976|drama,historical
Band of Brothers|Steven Spielberg|2001|war,drama
The Pacific|Steven Spielberg|2010|war,drama
Generation Kill|David Simon|2008|war,drama
House|David Shore|2004|drama,medical
The Good Wife|Robert King|2009|drama,legal
The Good Fight|Robert King|2017|drama,legal
Hill Street Blues|Steven Bochco|1981|crime,drama
Homicide: Life on the Street|Paul Attanasio|1993|crime,drama
The Shield|Shawn Ryan|2002|crime,drama
Justified|Graham Yost|2010|crime,drama
The Americans|Joe Weisberg|2013|thriller,drama
Homeland|Howard Gordon|2011|thriller,drama
The Night Manager|Susanne Bier|2016|thriller,drama
Pose|Ryan Murphy|2018|drama
The People v. O. J. Simpson|Scott Alexander|2016|drama,crime
American Crime Story|Ryan Murphy|2016|drama,crime
Dopesick|Danny Strong|2021|drama
The Staircase|Antonio Campos|2022|documentary,crime
When They See Us|Ava DuVernay|2019|drama,crime
The Haunting of Hill House|Mike Flanagan|2018|horror,drama
Midnight Mass|Mike Flanagan|2021|horror,drama
The Terror|David Kajganich|2018|horror,historical
Penny Dreadful|John Logan|2014|horror,fantasy
The Sandman|Neil Gaiman|2022|fantasy,drama
Good Omens|Neil Gaiman|2019|fantasy,comedy
The Good Place|Michael Schur|2016|comedy,fantasy
Russian Doll|Natasha Lyonne|2019|comedy,sci-fi
Severance|Dan Erickson|2022|sci-fi,thriller
Squid Game|Hwang Dong-hyuk|2021|thriller,drama
Kingdom|Kim Seong-hun|2019|horror,historical
My Mister|Kim Won-seok|2018|drama
Reply 1988|Shin Won-ho|2015|comedy,drama
Crash Landing on You|Lee Jung-hyo|2019|romance,drama
`.trim().split("\n");

export const EXPANSION_GAMES = `
The Legend of Zelda: Ocarina of Time|Nintendo EAD|1998|adventure,fantasy
The Legend of Zelda: Breath of the Wild|Nintendo EPD|2017|adventure,fantasy
The Legend of Zelda: Tears of the Kingdom|Nintendo EPD|2023|adventure,fantasy
The Legend of Zelda: Majora's Mask|Nintendo EAD|2000|adventure,fantasy
The Legend of Zelda: A Link to the Past|Nintendo EAD|1991|adventure,fantasy
Super Mario Bros. 3|Nintendo EAD|1988|platformer
Super Mario World|Nintendo EAD|1990|platformer
Super Mario 64|Nintendo EAD|1996|platformer
Super Mario Odyssey|Nintendo EPD|2017|platformer
Super Metroid|Nintendo R&D1|1994|action,adventure
Metroid Prime|Retro Studios|2002|action,adventure
Castlevania: Symphony of the Night|Konami|1997|action,adventure
Celeste|Maddy Makes Games|2018|platformer
Dead Cells|Motion Twin|2018|action,roguelike
The Binding of Isaac: Rebirth|Nicalis|2014|roguelike
Spelunky|Derek Yu|2012|platformer,roguelike
Enter the Gungeon|Dodge Roll|2016|roguelike
Cuphead|Studio MDHR|2017|platformer
Ori and the Blind Forest|Moon Studios|2015|platformer
Ori and the Will of the Wisps|Moon Studios|2020|platformer
Shadow of the Colossus|Team Ico|2005|adventure
Ico|Team Ico|2001|adventure
The Last of Us|Naughty Dog|2013|action,drama
The Last of Us Part II|Naughty Dog|2020|action,drama
Uncharted 2: Among Thieves|Naughty Dog|2009|action,adventure
Uncharted 4: A Thief's End|Naughty Dog|2016|action,adventure
God of War|Santa Monica Studio|2018|action,adventure
God of War Ragnarök|Santa Monica Studio|2022|action,adventure
Bloodborne|FromSoftware|2015|action,rpg
Dark Souls|FromSoftware|2011|action,rpg
Dark Souls III|FromSoftware|2016|action,rpg
Sekiro: Shadows Die Twice|FromSoftware|2019|action
Demon's Souls|FromSoftware|2009|action,rpg
Monster Hunter: World|Capcom|2018|action,rpg
Devil May Cry 5|Capcom|2019|action
Bayonetta 2|PlatinumGames|2014|action
Metal Gear Solid|Konami|1998|stealth,action
Metal Gear Solid 3: Snake Eater|Konami|2004|stealth,action
Metal Gear Solid V: The Phantom Pain|Kojima Productions|2015|stealth,action
Death Stranding|Kojima Productions|2019|adventure
Silent Hill 2|Team Silent|2001|horror
Resident Evil 4|Capcom|2005|horror,action
Resident Evil 2|Capcom|2019|horror
Resident Evil 7: Biohazard|Capcom|2017|horror
Alien: Isolation|Creative Assembly|2014|horror
Amnesia: The Dark Descent|Frictional Games|2010|horror
BioShock|Irrational Games|2007|sci-fi,shooter
BioShock Infinite|Irrational Games|2013|sci-fi,shooter
System Shock 2|Irrational Games|1999|sci-fi,horror
Deus Ex|Ion Storm|2000|sci-fi,rpg
Dishonored|Arkane Studios|2012|stealth,action
Prey|Arkane Studios|2017|sci-fi,horror
Half-Life|Valve|1998|sci-fi,shooter
Half-Life 2|Valve|2004|sci-fi,shooter
Portal|Valve|2007|puzzle
Portal 2|Valve|2011|puzzle
Doom|id Software|1993|shooter
Doom|id Software|2016|shooter
Doom Eternal|id Software|2020|shooter
Quake|id Software|1996|shooter
Halo: Combat Evolved|Bungie|2001|shooter
Halo 3|Bungie|2007|shooter
Halo: Reach|Bungie|2010|shooter
Gears of War|Epic Games|2006|shooter
Titanfall 2|Respawn Entertainment|2016|shooter
Call of Duty 4: Modern Warfare|Infinity Ward|2007|shooter
Mass Effect|BioWare|2007|sci-fi,rpg
Mass Effect 2|BioWare|2010|sci-fi,rpg
Mass Effect 3|BioWare|2012|sci-fi,rpg
Dragon Age: Origins|BioWare|2009|rpg,fantasy
Star Wars: Knights of the Old Republic|BioWare|2003|rpg,sci-fi
Star Wars Jedi: Fallen Order|Respawn Entertainment|2019|action,adventure
The Witcher 3: Wild Hunt|CD Projekt Red|2015|rpg,fantasy
The Witcher 2: Assassins of Kings|CD Projekt Red|2011|rpg,fantasy
Cyberpunk 2077|CD Projekt Red|2020|sci-fi,rpg
The Elder Scrolls V: Skyrim|Bethesda Game Studios|2011|rpg,fantasy
The Elder Scrolls IV: Oblivion|Bethesda Game Studios|2006|rpg,fantasy
The Elder Scrolls III: Morrowind|Bethesda Game Studios|2002|rpg,fantasy
Fallout 3|Bethesda Game Studios|2008|rpg,sci-fi
Fallout: New Vegas|Obsidian Entertainment|2010|rpg,sci-fi
Fallout 4|Bethesda Game Studios|2015|rpg,sci-fi
Baldur's Gate 3|Larian Studios|2023|rpg,fantasy
Baldur's Gate II: Shadows of Amn|BioWare|2000|rpg,fantasy
Planescape: Torment|Black Isle Studios|1999|rpg,fantasy
Disco Elysium|ZA/UM|2019|rpg,mystery
Divinity: Original Sin 2|Larian Studios|2017|rpg,fantasy
Pillars of Eternity|Obsidian Entertainment|2015|rpg,fantasy
Dragon Quest XI|Square Enix|2017|rpg,fantasy
Final Fantasy VI|Square|1994|rpg,fantasy
Final Fantasy VII|Square|1997|rpg,fantasy
Final Fantasy IX|Square|2000|rpg,fantasy
Final Fantasy X|Square|2001|rpg,fantasy
Final Fantasy XIV|Square Enix|2013|rpg,fantasy
Chrono Trigger|Square|1995|rpg,fantasy
Chrono Cross|Square|1999|rpg,fantasy
Persona 5|Atlus|2016|rpg,fantasy
Persona 4 Golden|Atlus|2012|rpg,fantasy
Nier: Automata|PlatinumGames|2017|action,rpg
Nier Replicant|Toylogic|2021|action,rpg
Octopath Traveler|Acquire|2018|rpg,fantasy
EarthBound|Ape|1994|rpg,comedy
Mother 3|Brownie Brown|2006|rpg
Stardew Valley|ConcernedApe|2016|simulation
Animal Crossing: New Horizons|Nintendo EPD|2020|simulation
Cities: Skylines|Colossal Order|2015|simulation
Sid Meier's Civilization VI|Firaxis Games|2016|strategy
Sid Meier's Civilization V|Firaxis Games|2010|strategy
Age of Empires II|Ensemble Studios|1999|strategy
StarCraft|Blizzard Entertainment|1998|strategy
Warcraft III: Reign of Chaos|Blizzard Entertainment|2002|strategy
XCOM 2|Firaxis Games|2016|strategy
XCOM: Enemy Unknown|Firaxis Games|2012|strategy
Into the Breach|Subset Games|2018|strategy
FTL: Faster Than Light|Subset Games|2012|strategy
Slay the Spire|Mega Crit|2019|strategy,roguelike
Return of the Obra Dinn|Lucas Pope|2018|puzzle,mystery
Outer Wilds|Mobius Digital|2019|adventure,mystery
The Witness|Thekla|2016|puzzle
Braid|Number None|2008|puzzle,platformer
Fez|Polytron|2012|puzzle,platformer
Flower|Thatgamecompany|2009|adventure
Abzû|Giant Squid|2016|adventure
Gris|Nomada Studio|2018|platformer
Inside|Playdead|2016|puzzle,platformer
Limbo|Playdead|2010|puzzle,platformer
Untitled Goose Game|House House|2019|puzzle,comedy
Katamari Damacy|Namco|2004|puzzle
Tetris Effect|Monstars|2018|puzzle
Beat Saber|Beat Games|2019|music
Wii Sports|Nintendo EAD|2006|sport
Mario Kart 8 Deluxe|Nintendo EPD|2017|racing
Super Smash Bros. Ultimate|Bandai Namco|2018|fighting
Super Smash Bros. Melee|HAL Laboratory|2001|fighting
Street Fighter II|Capcom|1991|fighting
Street Fighter 6|Capcom|2023|fighting
Tekken 7|Bandai Namco|2015|fighting
Mortal Kombat 11|NetherRealm Studios|2019|fighting
Guilty Gear Strive|Arc System Works|2021|fighting
Rocket League|Psyonix|2015|sport
Tony Hawk's Pro Skater 2|Neversoft|2000|sport
Forza Horizon 5|Playground Games|2021|racing
Balatro|LocalThunk|2024|card,roguelike
Animal Well|Shared Memory|2024|puzzle,platformer
Vampire Survivors|Poncle|2022|action,roguelike
Among Us|InnerSloth|2018|social
Terraria|Re-Logic|2011|sandbox,adventure
Factorio|Wube Software|2020|simulation,strategy
RimWorld|Ludeon Studios|2018|simulation,strategy
Dwarf Fortress|Bay 12 Games|2006|simulation,strategy
Kerbal Space Program|Squad|2015|simulation
Subnautica|Unknown Worlds|2018|survival,adventure
No Man's Sky|Hello Games|2016|sci-fi,adventure
A Short Hike|Adam Robinson-Yu|2019|adventure
Hollow Knight: Silksong|Team Cherry|2025|action,adventure
Blue Prince|Dogubomb|2025|puzzle
Clair Obscur: Expedition 33|Sandfall Interactive|2025|rpg,fantasy
Split Fiction|Hazelight Studios|2025|adventure,co-op
`.trim().split("\n");

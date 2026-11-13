/**
 * Catalog expansion, part 2: albums, podcasts and books.
 * One row per title: Title|Creator|Year|genre,genre
 * Metadata is factual (title, artist/author/host, year); no provider text is copied.
 */

export const EXPANSION_MUSIC = `
Abbey Road|The Beatles|1969|rock
Revolver|The Beatles|1966|rock
Sgt. Pepper's Lonely Hearts Club Band|The Beatles|1967|rock
Rubber Soul|The Beatles|1965|rock
The Dark Side of the Moon|Pink Floyd|1973|rock
Wish You Were Here|Pink Floyd|1975|rock
Animals|Pink Floyd|1977|rock
The Wall|Pink Floyd|1979|rock
OK Computer|Radiohead|1997|rock
The Bends|Radiohead|1995|rock
Amnesiac|Radiohead|2001|rock
good kid, m.A.A.d city|Kendrick Lamar|2012|hip-hop
To Pimp a Butterfly|Kendrick Lamar|2015|hip-hop
DAMN.|Kendrick Lamar|2017|hip-hop
Mr. Morale & the Big Steppers|Kendrick Lamar|2022|hip-hop
My Beautiful Dark Twisted Fantasy|Kanye West|2010|hip-hop
The College Dropout|Kanye West|2004|hip-hop
Late Registration|Kanye West|2005|hip-hop
808s & Heartbreak|Kanye West|2008|hip-hop
Yeezus|Kanye West|2013|hip-hop
The Blueprint|Jay-Z|2001|hip-hop
Reasonable Doubt|Jay-Z|1996|hip-hop
The Black Album|Jay-Z|2003|hip-hop
4:44|Jay-Z|2017|hip-hop
Illmatic|Nas|1994|hip-hop
It Was Written|Nas|1996|hip-hop
Aquemini|OutKast|1998|hip-hop
Stankonia|OutKast|2000|hip-hop
Speakerboxxx/The Love Below|OutKast|2003|hip-hop
The Low End Theory|A Tribe Called Quest|1991|hip-hop
Midnight Marauders|A Tribe Called Quest|1993|hip-hop
Enter the Wu-Tang (36 Chambers)|Wu-Tang Clan|1993|hip-hop
Liquid Swords|GZA|1995|hip-hop
Madvillainy|Madvillain|2004|hip-hop
Mm..Food|MF DOOM|2004|hip-hop
The Chronic|Dr. Dre|1992|hip-hop
2001|Dr. Dre|1999|hip-hop
Doggystyle|Snoop Dogg|1993|hip-hop
Me Against the World|2Pac|1995|hip-hop
All Eyez on Me|2Pac|1996|hip-hop
Ready to Die|The Notorious B.I.G.|1994|hip-hop
Life After Death|The Notorious B.I.G.|1997|hip-hop
The Miseducation of Lauryn Hill|Lauryn Hill|1998|hip-hop,soul
Baduizm|Erykah Badu|1997|soul
Mama's Gun|Erykah Badu|2000|soul
Voodoo|D'Angelo|2000|soul
Black Messiah|D'Angelo|2014|soul
Lemonade|Beyoncé|2016|pop
Renaissance|Beyoncé|2022|pop
A Seat at the Table|Solange|2016|soul
Ctrl|SZA|2017|r&b
SOS|SZA|2022|r&b
Flower Boy|Tyler, the Creator|2017|hip-hop
Igor|Tyler, the Creator|2019|hip-hop
Call Me If You Get Lost|Tyler, the Creator|2021|hip-hop
Awaken, My Love!|Childish Gambino|2016|soul
2014 Forest Hills Drive|J. Cole|2014|hip-hop
Take Care|Drake|2011|hip-hop
Supa Dupa Fly|Missy Elliott|1997|hip-hop
One in a Million|Aaliyah|1996|r&b
Anti|Rihanna|2016|pop
After Hours|The Weeknd|2020|pop
Discovery|Daft Punk|2001|electronic
Random Access Memories|Daft Punk|2013|electronic
Selected Ambient Works 85–92|Aphex Twin|1992|electronic
Drukqs|Aphex Twin|2001|electronic
Music Has the Right to Children|Boards of Canada|1998|electronic
Untrue|Burial|2007|electronic
Mezzanine|Massive Attack|1998|electronic
Blue Lines|Massive Attack|1991|electronic
Dummy|Portishead|1994|electronic
Homogenic|Björk|1997|electronic
Vespertine|Björk|2001|electronic
Hounds of Love|Kate Bush|1985|pop
The Kick Inside|Kate Bush|1978|pop
Low|David Bowie|1977|rock
Heroes|David Bowie|1977|rock
Station to Station|David Bowie|1976|rock
Blackstar|David Bowie|2016|rock
The Rise and Fall of Ziggy Stardust|David Bowie|1972|rock
Purple Rain|Prince|1984|pop
Sign o' the Times|Prince|1987|pop
Thriller|Michael Jackson|1982|pop
Off the Wall|Michael Jackson|1979|pop
Songs in the Key of Life|Stevie Wonder|1976|soul
Innervisions|Stevie Wonder|1973|soul
What's Going On|Marvin Gaye|1971|soul
Let's Get It On|Marvin Gaye|1973|soul
Superfly|Curtis Mayfield|1972|soul
There's a Riot Goin' On|Sly and the Family Stone|1971|soul
I Never Loved a Man the Way I Love You|Aretha Franklin|1967|soul
Blood on the Tracks|Bob Dylan|1975|folk
Highway 61 Revisited|Bob Dylan|1965|folk
Blonde on Blonde|Bob Dylan|1966|folk
Blue|Joni Mitchell|1971|folk
Court and Spark|Joni Mitchell|1974|folk
Songs of Leonard Cohen|Leonard Cohen|1967|folk
Pink Moon|Nick Drake|1972|folk
Astral Weeks|Van Morrison|1968|folk
The Velvet Underground & Nico|The Velvet Underground|1967|rock
Is This It|The Strokes|2001|rock
Turn on the Bright Lights|Interpol|2002|rock
Funeral|Arcade Fire|2004|rock
Boxer|The National|2007|rock
Illinois|Sufjan Stevens|2005|folk
For Emma, Forever Ago|Bon Iver|2007|folk
Currents|Tame Impala|2015|rock
Teen Dream|Beach House|2010|rock
Sound of Silver|LCD Soundsystem|2007|electronic
Remain in Light|Talking Heads|1980|rock
Unknown Pleasures|Joy Division|1979|rock
The Queen Is Dead|The Smiths|1986|rock
Disintegration|The Cure|1989|rock
Violator|Depeche Mode|1990|electronic
Power, Corruption & Lies|New Order|1983|electronic
London Calling|The Clash|1979|punk
Ramones|Ramones|1976|punk
Never Mind the Bollocks|Sex Pistols|1977|punk
Nevermind|Nirvana|1991|grunge
In Utero|Nirvana|1993|grunge
Ten|Pearl Jam|1991|grunge
Superunknown|Soundgarden|1994|grunge
Dirt|Alice in Chains|1992|grunge
Siamese Dream|The Smashing Pumpkins|1993|rock
Doolittle|Pixies|1989|rock
Daydream Nation|Sonic Youth|1988|rock
Automatic for the People|R.E.M.|1992|rock
The Joshua Tree|U2|1987|rock
Born to Run|Bruce Springsteen|1975|rock
Darkness on the Edge of Town|Bruce Springsteen|1978|rock
Harvest|Neil Young|1972|folk
Exodus|Bob Marley|1977|reggae
Kind of Blue|Miles Davis|1959|jazz
Bitches Brew|Miles Davis|1970|jazz
A Love Supreme|John Coltrane|1965|jazz
Giant Steps|John Coltrane|1960|jazz
Mingus Ah Um|Charles Mingus|1959|jazz
Brilliant Corners|Thelonious Monk|1957|jazz
Head Hunters|Herbie Hancock|1973|jazz
Journey in Satchidananda|Alice Coltrane|1971|jazz
The Shape of Jazz to Come|Ornette Coleman|1959|jazz
Chet Baker Sings|Chet Baker|1954|jazz
Otis Blue|Otis Redding|1965|soul
Modern Sounds in Country and Western Music|Ray Charles|1962|soul
At Last!|Etta James|1961|soul
Call Me|Al Green|1973|soul
Hot Buttered Soul|Isaac Hayes|1969|soul
Still Bill|Bill Withers|1972|soul
Jolene|Dolly Parton|1974|country
Coal Miner's Daughter|Loretta Lynn|1971|country
At Folsom Prison|Johnny Cash|1968|country
Red Headed Stranger|Willie Nelson|1975|country
Yankee Hotel Foxtrot|Wilco|2002|rock
Ágætis byrjun|Sigur Rós|1999|post-rock
Lift Your Skinny Fists Like Antennas to Heaven|Godspeed You! Black Emperor|2000|post-rock
The Earth Is Not a Cold Dead Place|Explosions in the Sky|2003|post-rock
Another Green World|Brian Eno|1975|ambient
Ambient 1: Music for Airports|Brian Eno|1978|ambient
Trans-Europe Express|Kraftwerk|1977|electronic
Computer World|Kraftwerk|1981|electronic
For You|Tatsuro Yamashita|1982|city pop
Variety|Mariya Takeuchi|1984|city pop
Solid State Survivor|Yellow Magic Orchestra|1979|electronic
Un Verano Sin Ti|Bad Bunny|2022|reggaeton
El Mal Querer|Rosalía|2018|flamenco
¿Dónde Están los Ladrones?|Shakira|1998|pop
Amor Prohibido|Selena|1994|tejano
A Tábua de Esmeralda|Jorge Ben|1974|mpb
Clube da Esquina|Milton Nascimento|1972|mpb
Wave|Antônio Carlos Jobim|1967|bossa nova
Getz/Gilberto|João Gilberto|1964|bossa nova
Zombie|Fela Kuti|1976|afrobeat
The Köln Concert|Keith Jarrett|1975|jazz
Songs from the Big Chair|Tears for Fears|1985|pop
The Downward Spiral|Nine Inch Nails|1994|industrial
The Fragile|Nine Inch Nails|1999|industrial
Kid A|Radiohead|2000|electronic
In Rainbows|Radiohead|2007|rock
Blonde|Frank Ocean|2016|r&b
Channel Orange|Frank Ocean|2012|r&b
Goodbye Yellow Brick Road|Elton John|1973|pop
Rumours|Fleetwood Mac|1977|rock
Pet Sounds|The Beach Boys|1966|pop
What's Your Pleasure?|Jessie Ware|2020|pop
Future Nostalgia|Dua Lipa|2020|pop
Melodrama|Lorde|2017|pop
1989|Taylor Swift|2014|pop
Folklore|Taylor Swift|2020|pop
Back to Black|Amy Winehouse|2006|soul
21|Adele|2011|pop
The Suburbs|Arcade Fire|2010|rock
`.trim().split("\n");

export const EXPANSION_PODCASTS = `
S-Town|Serial Productions|2017|documentary
Radiolab|WNYC Studios|2002|science
This American Life|Ira Glass|1995|documentary
Freakonomics Radio|Stephen J. Dubner|2010|economics
Planet Money|NPR|2008|economics
The Indicator|NPR|2018|economics
99% Invisible|Roman Mars|2010|design
Revisionist History|Malcolm Gladwell|2016|history
Reply All|Gimlet Media|2014|technology
The Ezra Klein Show|Ezra Klein|2014|politics
The Bill Simmons Podcast|Bill Simmons|2007|sport
The Rewatchables|The Ringer|2017|film
Conan O'Brien Needs a Friend|Conan O'Brien|2018|comedy
SmartLess|Jason Bateman|2020|comedy
WTF with Marc Maron|Marc Maron|2009|comedy
Comedy Bang Bang|Scott Aukerman|2009|comedy
How Did This Get Made?|Paul Scheer|2010|comedy,film
My Favorite Murder|Karen Kilgariff|2016|true crime
Last Podcast on the Left|Ben Kissel|2011|true crime,comedy
Casefile|Casefile Presents|2016|true crime
Criminal|Phoebe Judge|2014|true crime
Swindled|A Concerned Citizen|2018|true crime
Darknet Diaries|Jack Rhysider|2017|technology
Acquired|Ben Gilbert|2015|business
Invest Like the Best|Patrick O'Shaughnessy|2017|business
The Tim Ferriss Show|Tim Ferriss|2014|self-improvement
Huberman Lab|Andrew Huberman|2021|science
Hidden Brain|Shankar Vedantam|2015|psychology
The Happiness Lab|Laurie Santos|2019|psychology
Ten Percent Happier|Dan Harris|2016|self-improvement
On Being|Krista Tippett|2003|spirituality
Fresh Air|Terry Gross|1987|culture
The New Yorker Radio Hour|The New Yorker|2015|culture
Lex Fridman Podcast|Lex Fridman|2018|technology
The Joe Rogan Experience|Joe Rogan|2009|comedy
Stuff You Should Know|Josh Clark|2008|education
Sawbones|Justin McElroy|2013|medicine,comedy
My Brother, My Brother and Me|McElroy Family|2010|comedy
The Adventure Zone|McElroy Family|2014|actual play
Welcome to Night Vale|Night Vale Presents|2012|fiction
The Magnus Archives|Rusty Quill|2016|fiction,horror
Lore|Aaron Mahnke|2015|folklore
Unexplained|Richard MacLean Smith|2016|paranormal
Astonishing Legends|Scott Philbrook|2014|paranormal
No Such Thing as a Fish|QI|2014|comedy,trivia
The Dollop|Dave Anthony|2014|comedy,history
Behind the Bastards|Robert Evans|2018|history,comedy
You're Wrong About|Sarah Marshall|2018|history
Maintenance Phase|Aubrey Gordon|2020|health
If Books Could Kill|Peter Shamshiri|2022|culture
Search Engine|PJ Vogt|2022|technology
The Rest Is History|Tom Holland|2020|history
The Rest Is Politics|Alastair Campbell|2022|politics
The Diary of a CEO|Steven Bartlett|2017|business
Desert Island Discs|BBC Radio 4|1942|culture
In Our Time|Melvyn Bragg|1998|history
The Infinite Monkey Cage|Brian Cox|2009|science
More or Less|BBC Radio 4|2001|statistics
Pod Save America|Crooked Media|2017|politics
Pod Save the World|Crooked Media|2017|politics
Lovett or Leave It|Crooked Media|2017|comedy,politics
Decoder|Nilay Patel|2020|technology
Hard Fork|Kevin Roose|2020|technology
The Vergecast|The Verge|2011|technology
Accidental Tech Podcast|Marco Arment|2013|technology
The Talk Show|John Gruber|2012|technology
MacBreak Weekly|TWiT|2006|technology
The Daily|The New York Times|2017|news
Hardcore History|Dan Carlin|2006|history
Serial|Serial Productions|2014|true crime
`.trim().split("\n");

export const EXPANSION_BOOKS = `
1984|George Orwell|1949|dystopia,classic
Animal Farm|George Orwell|1945|satire,classic
Brave New World|Aldous Huxley|1932|dystopia,classic
Fahrenheit 451|Ray Bradbury|1953|dystopia,classic
The Handmaid's Tale|Margaret Atwood|1985|dystopia
The Road|Cormac McCarthy|2006|dystopia
Blood Meridian|Cormac McCarthy|1985|western
The Grapes of Wrath|John Steinbeck|1939|classic
East of Eden|John Steinbeck|1952|classic
Of Mice and Men|John Steinbeck|1937|classic
The Great Gatsby|F. Scott Fitzgerald|1925|classic
To Kill a Mockingbird|Harper Lee|1960|classic
In Cold Blood|Truman Capote|1966|true crime
The Catcher in the Rye|J. D. Salinger|1951|classic
Slaughterhouse-Five|Kurt Vonnegut|1969|sci-fi,classic
Cat's Cradle|Kurt Vonnegut|1963|sci-fi,satire
Catch-22|Joseph Heller|1961|satire,war
One Flew Over the Cuckoo's Nest|Ken Kesey|1962|classic
On the Road|Jack Kerouac|1957|classic
The Bell Jar|Sylvia Plath|1963|classic
Mrs Dalloway|Virginia Woolf|1925|classic
To the Lighthouse|Virginia Woolf|1927|classic
Ulysses|James Joyce|1922|classic
Dubliners|James Joyce|1914|classic
The Sound and the Fury|William Faulkner|1929|classic
As I Lay Dying|William Faulkner|1930|classic
Their Eyes Were Watching God|Zora Neale Hurston|1937|classic
Native Son|Richard Wright|1940|classic
Invisible Man|Ralph Ellison|1952|classic
The Bluest Eye|Toni Morrison|1970|classic
Song of Solomon|Toni Morrison|1977|classic
Sula|Toni Morrison|1973|classic
Things Fall Apart|Chinua Achebe|1958|classic
Half of a Yellow Sun|Chimamanda Ngozi Adichie|2006|historical fiction
Americanah|Chimamanda Ngozi Adichie|2013|fiction
The God of Small Things|Arundhati Roy|1997|fiction
Midnight's Children|Salman Rushdie|1981|magical realism
A House for Mr Biswas|V. S. Naipaul|1961|classic
The Remains of the Day|Kazuo Ishiguro|1989|fiction
Never Let Me Go|Kazuo Ishiguro|2005|sci-fi
Klara and the Sun|Kazuo Ishiguro|2021|sci-fi
Norwegian Wood|Haruki Murakami|1987|fiction
Kafka on the Shore|Haruki Murakami|2002|magical realism
The Wind-Up Bird Chronicle|Haruki Murakami|1994|magical realism
1Q84|Haruki Murakami|2009|fiction
Hard-Boiled Wonderland and the End of the World|Haruki Murakami|1985|sci-fi
Snow Country|Yasunari Kawabata|1948|classic
Kokoro|Natsume Soseki|1914|classic
The Tale of Genji|Murasaki Shikibu|1010|classic
The Three-Body Problem|Liu Cixin|2008|sci-fi
The Dark Forest|Liu Cixin|2008|sci-fi
Death's End|Liu Cixin|2010|sci-fi
Solaris|Stanisław Lem|1961|sci-fi
Dune|Frank Herbert|1965|sci-fi
Foundation|Isaac Asimov|1951|sci-fi
I, Robot|Isaac Asimov|1950|sci-fi
Neuromancer|William Gibson|1984|cyberpunk
Snow Crash|Neal Stephenson|1992|cyberpunk
Cryptonomicon|Neal Stephenson|1999|sci-fi
Hyperion|Dan Simmons|1989|sci-fi
The Left Hand of Darkness|Ursula K. Le Guin|1969|sci-fi
The Dispossessed|Ursula K. Le Guin|1974|sci-fi
A Wizard of Earthsea|Ursula K. Le Guin|1968|fantasy
The Hobbit|J. R. R. Tolkien|1937|fantasy
The Lord of the Rings|J. R. R. Tolkien|1954|fantasy
A Game of Thrones|George R. R. Martin|1996|fantasy
A Storm of Swords|George R. R. Martin|2000|fantasy
The Name of the Wind|Patrick Rothfuss|2007|fantasy
Mistborn|Brandon Sanderson|2006|fantasy
The Way of Kings|Brandon Sanderson|2010|fantasy
The Blade Itself|Joe Abercrombie|2006|fantasy
The Lies of Locke Lamora|Scott Lynch|2006|fantasy
The Fifth Season|N. K. Jemisin|2015|fantasy
Ancillary Justice|Ann Leckie|2013|sci-fi
A Memory Called Empire|Arkady Martine|2019|sci-fi
Gideon the Ninth|Tamsyn Muir|2019|sci-fi,fantasy
Jonathan Strange & Mr Norrell|Susanna Clarke|2004|fantasy
The Night Circus|Erin Morgenstern|2011|fantasy
American Gods|Neil Gaiman|2001|fantasy
Neverwhere|Neil Gaiman|1996|fantasy
Good Omens|Terry Pratchett|1990|fantasy,comedy
Mort|Terry Pratchett|1987|fantasy,comedy
Guards! Guards!|Terry Pratchett|1989|fantasy,comedy
Small Gods|Terry Pratchett|1992|fantasy,comedy
The Colour of Magic|Terry Pratchett|1983|fantasy,comedy
The Hitchhiker's Guide to the Galaxy|Douglas Adams|1979|sci-fi,comedy
The Princess Bride|William Goldman|1973|fantasy,comedy
Watership Down|Richard Adams|1972|fantasy
The Once and Future King|T. H. White|1958|fantasy
Northern Lights|Philip Pullman|1995|fantasy
The Amber Spyglass|Philip Pullman|2000|fantasy
Harry Potter and the Philosopher's Stone|J. K. Rowling|1997|fantasy
Harry Potter and the Prisoner of Azkaban|J. K. Rowling|1999|fantasy
The Hunger Games|Suzanne Collins|2008|dystopia
Catching Fire|Suzanne Collins|2009|dystopia
The Giver|Lois Lowry|1993|dystopia
A Wrinkle in Time|Madeleine L'Engle|1962|sci-fi
The Little Prince|Antoine de Saint-Exupéry|1943|classic
Lord of the Flies|William Golding|1954|classic
The Picture of Dorian Gray|Oscar Wilde|1890|classic
Frankenstein|Mary Shelley|1818|horror,classic
Dracula|Bram Stoker|1897|horror,classic
Jane Eyre|Charlotte Brontë|1847|classic
Wuthering Heights|Emily Brontë|1847|classic
Pride and Prejudice|Jane Austen|1813|romance,classic
Emma|Jane Austen|1815|classic
Persuasion|Jane Austen|1817|romance,classic
Great Expectations|Charles Dickens|1861|classic
A Tale of Two Cities|Charles Dickens|1859|historical fiction
Bleak House|Charles Dickens|1853|classic
Middlemarch|George Eliot|1871|classic
Vanity Fair|William Makepeace Thackeray|1848|classic
Moby-Dick|Herman Melville|1851|classic
The Scarlet Letter|Nathaniel Hawthorne|1850|classic
The Adventures of Huckleberry Finn|Mark Twain|1884|classic
Heart of Darkness|Joseph Conrad|1899|classic
Crime and Punishment|Fyodor Dostoevsky|1866|classic
The Brothers Karamazov|Fyodor Dostoevsky|1880|classic
Notes from Underground|Fyodor Dostoevsky|1864|classic
Anna Karenina|Leo Tolstoy|1878|classic
War and Peace|Leo Tolstoy|1869|historical fiction
The Death of Ivan Ilyich|Leo Tolstoy|1886|classic
Fathers and Sons|Ivan Turgenev|1862|classic
Dead Souls|Nikolai Gogol|1842|satire
The Master and Margarita|Mikhail Bulgakov|1967|magical realism
Doctor Zhivago|Boris Pasternak|1957|historical fiction
One Day in the Life of Ivan Denisovich|Aleksandr Solzhenitsyn|1962|historical fiction
The Trial|Franz Kafka|1925|classic
The Metamorphosis|Franz Kafka|1915|classic
The Castle|Franz Kafka|1926|classic
Steppenwolf|Hermann Hesse|1927|classic
Siddhartha|Hermann Hesse|1922|classic
The Magic Mountain|Thomas Mann|1924|classic
Death in Venice|Thomas Mann|1912|classic
The Radetzky March|Joseph Roth|1932|historical fiction
Austerlitz|W. G. Sebald|2001|fiction
My Brilliant Friend|Elena Ferrante|2011|fiction
The Story of a New Name|Elena Ferrante|2012|fiction
Those Who Leave and Those Who Stay|Elena Ferrante|2013|fiction
The Story of the Lost Child|Elena Ferrante|2014|fiction
The Leopard|Giuseppe Tomasi di Lampedusa|1958|historical fiction
If on a winter's night a traveler|Italo Calvino|1979|fiction
Invisible Cities|Italo Calvino|1972|fiction
The Name of the Rose|Umberto Eco|1980|mystery,historical
Foucault's Pendulum|Umberto Eco|1988|mystery
One Hundred Years of Solitude|Gabriel García Márquez|1967|magical realism
Love in the Time of Cholera|Gabriel García Márquez|1985|romance
Chronicle of a Death Foretold|Gabriel García Márquez|1981|fiction
Hopscotch|Julio Cortázar|1963|fiction
Ficciones|Jorge Luis Borges|1944|short stories
Pedro Páramo|Juan Rulfo|1955|fiction
The Savage Detectives|Roberto Bolaño|1998|fiction
2666|Roberto Bolaño|2004|fiction
The House of the Spirits|Isabel Allende|1982|magical realism
Like Water for Chocolate|Laura Esquivel|1989|romance
The Alchemist|Paulo Coelho|1988|fiction
Blindness|José Saramago|1995|dystopia
The Hour of the Star|Clarice Lispector|1977|fiction
Dom Casmurro|Machado de Assis|1899|classic
The Posthumous Memoirs of Brás Cubas|Machado de Assis|1881|classic
The Book of Disquiet|Fernando Pessoa|1982|fiction
The Unbearable Lightness of Being|Milan Kundera|1984|fiction
The Joke|Milan Kundera|1967|fiction
The Museum of Unconditional Surrender|Dubravka Ugrešić|1996|fiction
The White Tiger|Aravind Adiga|2008|fiction
A Fine Balance|Rohinton Mistry|1995|fiction
The Reluctant Fundamentalist|Mohsin Hamid|2007|fiction
Exit West|Mohsin Hamid|2017|fiction
The Kite Runner|Khaled Hosseini|2003|fiction
A Thousand Splendid Suns|Khaled Hosseini|2007|fiction
Persepolis|Marjane Satrapi|2000|graphic novel,memoir
Maus|Art Spiegelman|1986|graphic novel,memoir
Fun Home|Alison Bechdel|2006|graphic novel,memoir
Watchmen|Alan Moore|1986|graphic novel
The Sandman|Neil Gaiman|1989|graphic novel,fantasy
Saga|Brian K. Vaughan|2012|graphic novel,sci-fi
Bone|Jeff Smith|1991|graphic novel,fantasy
`.trim().split("\n");

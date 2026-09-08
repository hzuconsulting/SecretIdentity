import type { Identity } from '../types';

/**
 * Catalogue des identités.
 *
 * Règles :
 *  - `id` en kebab-case, stable et unique (il sert de clé réseau).
 *  - `name` est la seule chose affichée : **aucune image, aucun logo**.
 *  - Pour ajouter une identité, ajoutez une ligne dans la bonne section.
 *  - Le champ `packs` est optionnel ; une identité sans `packs` appartient
 *    au pack `base` (cf. `IDENTITY_PACKS` plus bas).
 *
 * Répartition visée : ~45 % easy · ~40 % medium · ~15 % hard.
 */
export const IDENTITIES: Identity[] = [
  // ── DISNEY ────────────────────────────────────────────────
  { id: 'mickey-mouse', name: 'Mickey Mouse', category: 'disney', difficulty: 'easy' },
  { id: 'minnie-mouse', name: 'Minnie Mouse', category: 'disney', difficulty: 'easy' },
  { id: 'donald-duck', name: 'Donald Duck', category: 'disney', difficulty: 'easy' },
  { id: 'dingo', name: 'Dingo', category: 'disney', difficulty: 'easy' },
  { id: 'picsou', name: 'Picsou', category: 'disney', difficulty: 'easy' },
  { id: 'simba', name: 'Simba', category: 'disney', difficulty: 'easy' },
  { id: 'mufasa', name: 'Mufasa', category: 'disney', difficulty: 'easy' },
  { id: 'scar', name: 'Scar', category: 'disney', difficulty: 'easy' },
  { id: 'timon', name: 'Timon', category: 'disney', difficulty: 'hard' },
  { id: 'pumbaa', name: 'Pumbaa', category: 'disney', difficulty: 'medium' },
  { id: 'ariel', name: 'Ariel', category: 'disney', difficulty: 'easy' },
  { id: 'ursula', name: 'Ursula', category: 'disney', difficulty: 'hard' },
  { id: 'aladdin', name: 'Aladdin', category: 'disney', difficulty: 'easy' },
  { id: 'jasmine', name: 'Jasmine', category: 'disney', difficulty: 'easy' },
  { id: 'le-genie', name: 'Le Génie', category: 'disney', difficulty: 'easy' },
  { id: 'cendrillon', name: 'Cendrillon', category: 'disney', difficulty: 'easy' },
  { id: 'blanche-neige', name: 'Blanche-Neige', category: 'disney', difficulty: 'easy' },
  { id: 'belle', name: 'Belle', category: 'disney', difficulty: 'easy' },
  { id: 'la-bete', name: 'La Bête', category: 'disney', difficulty: 'easy' },
  { id: 'elsa', name: 'Elsa', category: 'disney', difficulty: 'easy' },
  { id: 'anna', name: 'Anna', category: 'disney', difficulty: 'easy' },
  { id: 'olaf', name: 'Olaf', category: 'disney', difficulty: 'easy' },
  { id: 'raiponce', name: 'Raiponce', category: 'disney', difficulty: 'easy' },
  { id: 'malefique', name: 'Maléfique', category: 'disney', difficulty: 'easy' },
  { id: 'peter-pan', name: 'Peter Pan', category: 'disney', difficulty: 'easy' },
  { id: 'capitaine-crochet', name: 'Capitaine Crochet', category: 'disney', difficulty: 'easy' },
  { id: 'clochette', name: 'La Fée Clochette', category: 'disney', difficulty: 'medium' },
  { id: 'dumbo', name: 'Dumbo', category: 'disney', difficulty: 'easy' },
  { id: 'bambi', name: 'Bambi', category: 'disney', difficulty: 'easy' },
  { id: 'cruella', name: "Cruella d'Enfer", category: 'disney', difficulty: 'easy' },
  { id: 'mulan', name: 'Mulan', category: 'disney', difficulty: 'easy' },
  { id: 'pocahontas', name: 'Pocahontas', category: 'disney', difficulty: 'easy' },
  { id: 'baloo', name: 'Baloo', category: 'disney', difficulty: 'easy' },
  { id: 'mowgli', name: 'Mowgli', category: 'disney', difficulty: 'easy' },
  { id: 'stitch', name: 'Stitch', category: 'disney', difficulty: 'easy' },
  { id: 'hercule', name: 'Hercule', category: 'disney', difficulty: 'medium' },
  { id: 'quasimodo', name: 'Quasimodo', category: 'disney', difficulty: 'hard' },

  // ── ANIMATION & BANDE DESSINÉE ────────────────────────────
  { id: 'buzz-leclair', name: "Buzz l'Éclair", category: 'animation', difficulty: 'easy' },
  { id: 'woody', name: 'Woody', category: 'animation', difficulty: 'easy' },
  { id: 'nemo', name: 'Nemo', category: 'animation', difficulty: 'easy' },
  { id: 'dory', name: 'Dory', category: 'animation', difficulty: 'easy' },
  { id: 'wall-e', name: 'WALL-E', category: 'animation', difficulty: 'medium' },
  { id: 'remy-ratatouille', name: 'Rémy (Ratatouille)', category: 'animation', difficulty: 'medium' },
  { id: 'shrek', name: 'Shrek', category: 'animation', difficulty: 'easy' },
  { id: 'fiona', name: 'Princesse Fiona', category: 'animation', difficulty: 'easy' },
  { id: 'ane-shrek', name: "L'Âne (Shrek)", category: 'animation', difficulty: 'medium' },
  { id: 'totoro', name: 'Totoro', category: 'animation', difficulty: 'easy' },
  { id: 'bugs-bunny', name: 'Bugs Bunny', category: 'animation', difficulty: 'easy' },
  { id: 'titi', name: 'Titi', category: 'animation', difficulty: 'medium' },
  { id: 'tom-et-jerry', name: 'Tom et Jerry', category: 'animation', difficulty: 'easy' },
  { id: 'scooby-doo', name: 'Scooby-Doo', category: 'animation', difficulty: 'easy' },
  { id: 'homer-simpson', name: 'Homer Simpson', category: 'animation', difficulty: 'easy' },
  { id: 'bart-simpson', name: 'Bart Simpson', category: 'animation', difficulty: 'easy' },
  { id: 'lisa-simpson', name: 'Lisa Simpson', category: 'animation', difficulty: 'easy' },
  { id: 'bob-leponge', name: "Bob l'éponge", category: 'animation', difficulty: 'easy' },
  { id: 'patrick-etoile', name: 'Patrick Étoile', category: 'animation', difficulty: 'easy' },
  { id: 'sangoku', name: 'San Goku', category: 'animation', difficulty: 'easy' },
  { id: 'vegeta', name: 'Végéta', category: 'animation', difficulty: 'easy' },
  { id: 'naruto', name: 'Naruto', category: 'animation', difficulty: 'easy' },
  { id: 'sasuke', name: 'Sasuke', category: 'animation', difficulty: 'hard' },
  { id: 'luffy', name: 'Monkey D. Luffy', category: 'animation', difficulty: 'medium' },
  { id: 'zoro', name: 'Roronoa Zoro', category: 'animation', difficulty: 'hard' },
  { id: 'asterix', name: 'Astérix', category: 'animation', difficulty: 'easy' },
  { id: 'obelix', name: 'Obélix', category: 'animation', difficulty: 'easy' },
  { id: 'panoramix', name: 'Panoramix', category: 'animation', difficulty: 'easy' },
  { id: 'tintin', name: 'Tintin', category: 'animation', difficulty: 'easy' },
  { id: 'milou', name: 'Milou', category: 'animation', difficulty: 'easy' },
  { id: 'capitaine-haddock', name: 'Capitaine Haddock', category: 'animation', difficulty: 'easy' },
  { id: 'lucky-luke', name: 'Lucky Luke', category: 'animation', difficulty: 'easy' },
  { id: 'gaston-lagaffe', name: 'Gaston Lagaffe', category: 'animation', difficulty: 'easy' },
  { id: 'titeuf', name: 'Titeuf', category: 'animation', difficulty: 'medium' },
  { id: 'papa-schtroumpf', name: 'Le Grand Schtroumpf', category: 'animation', difficulty: 'medium' },
  { id: 'gargamel', name: 'Gargamel', category: 'animation', difficulty: 'hard' },
  { id: 'marsupilami', name: 'Marsupilami', category: 'animation', difficulty: 'medium' },
  { id: 'garfield', name: 'Garfield', category: 'animation', difficulty: 'easy' },

  // ── SUPER-HÉROS ───────────────────────────────────────────
  { id: 'superman', name: 'Superman', category: 'superhero', difficulty: 'easy' },
  { id: 'batman', name: 'Batman', category: 'superhero', difficulty: 'easy' },
  { id: 'spider-man', name: 'Spider-Man', category: 'superhero', difficulty: 'easy' },
  { id: 'iron-man', name: 'Iron Man', category: 'superhero', difficulty: 'easy' },
  { id: 'captain-america', name: 'Captain America', category: 'superhero', difficulty: 'easy' },
  { id: 'thor', name: 'Thor', category: 'superhero', difficulty: 'easy' },
  { id: 'hulk', name: 'Hulk', category: 'superhero', difficulty: 'easy' },
  { id: 'black-widow', name: 'Black Widow', category: 'superhero', difficulty: 'medium' },
  { id: 'wonder-woman', name: 'Wonder Woman', category: 'superhero', difficulty: 'easy' },
  { id: 'flash', name: 'Flash', category: 'superhero', difficulty: 'medium' },
  { id: 'aquaman', name: 'Aquaman', category: 'superhero', difficulty: 'medium' },
  { id: 'doctor-strange', name: 'Doctor Strange', category: 'superhero', difficulty: 'medium' },
  { id: 'black-panther', name: 'Black Panther', category: 'superhero', difficulty: 'medium' },
  { id: 'deadpool', name: 'Deadpool', category: 'superhero', difficulty: 'medium' },
  { id: 'wolverine', name: 'Wolverine', category: 'superhero', difficulty: 'medium' },
  { id: 'magneto', name: 'Magnéto', category: 'superhero', difficulty: 'hard' },
  { id: 'joker', name: 'Le Joker', category: 'superhero', difficulty: 'easy' },
  { id: 'harley-quinn', name: 'Harley Quinn', category: 'superhero', difficulty: 'medium' },
  { id: 'catwoman', name: 'Catwoman', category: 'superhero', difficulty: 'medium' },
  { id: 'thanos', name: 'Thanos', category: 'superhero', difficulty: 'medium' },
  { id: 'loki', name: 'Loki', category: 'superhero', difficulty: 'medium' },
  { id: 'groot', name: 'Groot', category: 'superhero', difficulty: 'medium' },
  { id: 'hawkeye', name: 'Œil-de-Faucon', category: 'superhero', difficulty: 'hard' },

  // ── CINÉMA ────────────────────────────────────────────────
  { id: 'harry-potter', name: 'Harry Potter', category: 'cinema', difficulty: 'easy' },
  { id: 'hermione-granger', name: 'Hermione Granger', category: 'cinema', difficulty: 'easy' },
  { id: 'ron-weasley', name: 'Ron Weasley', category: 'cinema', difficulty: 'easy' },
  { id: 'dumbledore', name: 'Albus Dumbledore', category: 'cinema', difficulty: 'easy' },
  { id: 'voldemort', name: 'Voldemort', category: 'cinema', difficulty: 'easy' },
  { id: 'hagrid', name: 'Hagrid', category: 'cinema', difficulty: 'easy' },
  { id: 'severus-rogue', name: 'Severus Rogue', category: 'cinema', difficulty: 'hard' },
  { id: 'dark-vador', name: 'Dark Vador', category: 'cinema', difficulty: 'easy' },
  { id: 'luke-skywalker', name: 'Luke Skywalker', category: 'cinema', difficulty: 'easy' },
  { id: 'princesse-leia', name: 'Princesse Leia', category: 'cinema', difficulty: 'easy' },
  { id: 'yoda', name: 'Yoda', category: 'cinema', difficulty: 'easy' },
  { id: 'chewbacca', name: 'Chewbacca', category: 'cinema', difficulty: 'easy' },
  { id: 'han-solo', name: 'Han Solo', category: 'cinema', difficulty: 'easy' },
  { id: 'r2d2', name: 'R2-D2', category: 'cinema', difficulty: 'medium' },
  { id: 'indiana-jones', name: 'Indiana Jones', category: 'cinema', difficulty: 'easy' },
  { id: 'james-bond', name: 'James Bond', category: 'cinema', difficulty: 'easy' },
  { id: 'rocky-balboa', name: 'Rocky Balboa', category: 'cinema', difficulty: 'medium' },
  { id: 'terminator', name: 'Terminator', category: 'cinema', difficulty: 'easy' },
  { id: 'forrest-gump', name: 'Forrest Gump', category: 'cinema', difficulty: 'medium' },
  { id: 'jack-sparrow', name: 'Jack Sparrow', category: 'cinema', difficulty: 'easy' },
  { id: 'marty-mcfly', name: 'Marty McFly', category: 'cinema', difficulty: 'medium' },
  { id: 'e-t', name: 'E.T.', category: 'cinema', difficulty: 'easy' },
  { id: 'gandalf', name: 'Gandalf', category: 'cinema', difficulty: 'easy' },
  { id: 'frodon', name: 'Frodon', category: 'cinema', difficulty: 'medium' },
  { id: 'gollum', name: 'Gollum', category: 'cinema', difficulty: 'medium' },
  { id: 'aragorn', name: 'Aragorn', category: 'cinema', difficulty: 'hard' },
  { id: 'legolas', name: 'Legolas', category: 'cinema', difficulty: 'medium' },
  { id: 'willy-wonka', name: 'Willy Wonka', category: 'cinema', difficulty: 'medium' },
  { id: 'mary-poppins', name: 'Mary Poppins', category: 'cinema', difficulty: 'easy' },
  { id: 'king-kong', name: 'King Kong', category: 'cinema', difficulty: 'easy' },
  { id: 'godzilla', name: 'Godzilla', category: 'cinema', difficulty: 'easy' },
  { id: 'neo-matrix', name: 'Neo (Matrix)', category: 'cinema', difficulty: 'medium' },
  { id: 'jack-dawson', name: 'Jack Dawson (Titanic)', category: 'cinema', difficulty: 'medium' },
  { id: 'hannibal-lecter', name: 'Hannibal Lecter', category: 'cinema', difficulty: 'hard' },
  { id: 'vito-corleone', name: 'Vito Corleone', category: 'cinema', difficulty: 'hard' },
  { id: 'tony-montana', name: 'Tony Montana', category: 'cinema', difficulty: 'hard' },
  { id: 'edward-scissorhands', name: 'Edward aux mains d’argent', category: 'cinema', difficulty: 'hard' },
  { id: 'amelie-poulain', name: 'Amélie Poulain', category: 'cinema', difficulty: 'medium' },
  { id: 'le-grand-bleu', name: 'Jacques Mayol', category: 'cinema', difficulty: 'hard' },
  { id: 'leon-le-pro', name: 'Léon', category: 'cinema', difficulty: 'hard' },

  // ── SÉRIES ────────────────────────────────────────────────
  { id: 'walter-white', name: 'Walter White', category: 'serie', difficulty: 'medium' },
  { id: 'jesse-pinkman', name: 'Jesse Pinkman', category: 'serie', difficulty: 'hard' },
  { id: 'daenerys', name: 'Daenerys Targaryen', category: 'serie', difficulty: 'medium' },
  { id: 'jon-snow', name: 'Jon Snow', category: 'serie', difficulty: 'medium' },
  { id: 'tyrion-lannister', name: 'Tyrion Lannister', category: 'serie', difficulty: 'medium' },
  { id: 'arya-stark', name: 'Arya Stark', category: 'serie', difficulty: 'hard' },
  { id: 'eleven', name: 'Eleven', category: 'serie', difficulty: 'medium' },
  { id: 'dexter-morgan', name: 'Dexter Morgan', category: 'serie', difficulty: 'hard' },
  { id: 'michael-scott', name: 'Michael Scott', category: 'serie', difficulty: 'hard' },
  { id: 'ross-geller', name: 'Ross Geller', category: 'serie', difficulty: 'medium' },
  { id: 'rachel-green', name: 'Rachel Green', category: 'serie', difficulty: 'medium' },
  { id: 'joey-tribbiani', name: 'Joey Tribbiani', category: 'serie', difficulty: 'medium' },
  { id: 'chandler-bing', name: 'Chandler Bing', category: 'serie', difficulty: 'hard' },
  { id: 'phoebe-buffay', name: 'Phoebe Buffay', category: 'serie', difficulty: 'hard' },
  { id: 'dr-house', name: 'Docteur House', category: 'serie', difficulty: 'medium' },
  { id: 'mr-bean', name: 'Mr Bean', category: 'serie', difficulty: 'easy' },
  { id: 'columbo', name: 'Columbo', category: 'serie', difficulty: 'medium' },
  { id: 'jack-bauer', name: 'Jack Bauer', category: 'serie', difficulty: 'hard' },
  { id: 'don-draper', name: 'Don Draper', category: 'serie', difficulty: 'hard' },
  { id: 'tony-soprano', name: 'Tony Soprano', category: 'serie', difficulty: 'hard' },
  { id: 'kaamelott-arthur', name: 'Le Roi Arthur (Kaamelott)', category: 'serie', difficulty: 'medium' },
  { id: 'perceval', name: 'Perceval', category: 'serie', difficulty: 'medium' },

  // ── JEUX VIDÉO ────────────────────────────────────────────
  { id: 'mario', name: 'Mario', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'luigi', name: 'Luigi', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'princesse-peach', name: 'Princesse Peach', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'bowser', name: 'Bowser', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'yoshi', name: 'Yoshi', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'donkey-kong', name: 'Donkey Kong', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'link', name: 'Link', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'zelda', name: 'Zelda', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'sonic', name: 'Sonic', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'pikachu', name: 'Pikachu', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'dracaufeu', name: 'Dracaufeu', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'kirby', name: 'Kirby', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'samus-aran', name: 'Samus Aran', category: 'jeuvideo', difficulty: 'hard' },
  { id: 'pac-man', name: 'Pac-Man', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'lara-croft', name: 'Lara Croft', category: 'jeuvideo', difficulty: 'easy' },
  { id: 'master-chief', name: 'Master Chief', category: 'jeuvideo', difficulty: 'hard' },
  { id: 'kratos', name: 'Kratos', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'geralt-de-riv', name: 'Geralt de Riv', category: 'jeuvideo', difficulty: 'hard' },
  { id: 'ezio-auditore', name: 'Ezio Auditore', category: 'jeuvideo', difficulty: 'hard' },
  { id: 'creeper', name: 'Creeper', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'crash-bandicoot', name: 'Crash Bandicoot', category: 'jeuvideo', difficulty: 'medium' },
  { id: 'rayman', name: 'Rayman', category: 'jeuvideo', difficulty: 'medium' },

  // ── CÉLÉBRITÉS ────────────────────────────────────────────
  { id: 'charlie-chaplin', name: 'Charlie Chaplin', category: 'celebrite', difficulty: 'easy' },
  { id: 'marilyn-monroe', name: 'Marilyn Monroe', category: 'celebrite', difficulty: 'medium' },
  { id: 'audrey-hepburn', name: 'Audrey Hepburn', category: 'celebrite', difficulty: 'hard' },
  { id: 'louis-de-funes', name: 'Louis de Funès', category: 'celebrite', difficulty: 'medium' },
  { id: 'jean-dujardin', name: 'Jean Dujardin', category: 'celebrite', difficulty: 'medium' },
  { id: 'omar-sy', name: 'Omar Sy', category: 'celebrite', difficulty: 'medium' },
  { id: 'brigitte-bardot', name: 'Brigitte Bardot', category: 'celebrite', difficulty: 'hard' },
  { id: 'steve-jobs', name: 'Steve Jobs', category: 'celebrite', difficulty: 'medium' },
  { id: 'bill-gates', name: 'Bill Gates', category: 'celebrite', difficulty: 'medium' },
  { id: 'elon-musk', name: 'Elon Musk', category: 'celebrite', difficulty: 'easy' },
  { id: 'walt-disney', name: 'Walt Disney', category: 'celebrite', difficulty: 'easy' },
  { id: 'coco-chanel', name: 'Coco Chanel', category: 'celebrite', difficulty: 'medium' },
  { id: 'thomas-pesquet', name: 'Thomas Pesquet', category: 'celebrite', difficulty: 'medium' },
  { id: 'gordon-ramsay', name: 'Gordon Ramsay', category: 'celebrite', difficulty: 'medium' },
  { id: 'paul-bocuse', name: 'Paul Bocuse', category: 'celebrite', difficulty: 'hard' },
  { id: 'jacques-cousteau', name: 'Jacques-Yves Cousteau', category: 'celebrite', difficulty: 'medium' },
  { id: 'david-attenborough', name: 'David Attenborough', category: 'celebrite', difficulty: 'hard' },
  { id: 'oprah-winfrey', name: 'Oprah Winfrey', category: 'celebrite', difficulty: 'medium' },

  // ── SPORT ─────────────────────────────────────────────────
  { id: 'zinedine-zidane', name: 'Zinédine Zidane', category: 'sport', difficulty: 'easy' },
  { id: 'kylian-mbappe', name: 'Kylian Mbappé', category: 'sport', difficulty: 'easy' },
  { id: 'lionel-messi', name: 'Lionel Messi', category: 'sport', difficulty: 'easy' },
  { id: 'cristiano-ronaldo', name: 'Cristiano Ronaldo', category: 'sport', difficulty: 'easy' },
  { id: 'antoine-griezmann', name: 'Antoine Griezmann', category: 'sport', difficulty: 'medium' },
  { id: 'michael-jordan', name: 'Michael Jordan', category: 'sport', difficulty: 'easy' },
  { id: 'lebron-james', name: 'LeBron James', category: 'sport', difficulty: 'medium' },
  { id: 'tony-parker', name: 'Tony Parker', category: 'sport', difficulty: 'medium' },
  { id: 'usain-bolt', name: 'Usain Bolt', category: 'sport', difficulty: 'easy' },
  { id: 'roger-federer', name: 'Roger Federer', category: 'sport', difficulty: 'medium' },
  { id: 'rafael-nadal', name: 'Rafael Nadal', category: 'sport', difficulty: 'medium' },
  { id: 'serena-williams', name: 'Serena Williams', category: 'sport', difficulty: 'medium' },
  { id: 'teddy-riner', name: 'Teddy Riner', category: 'sport', difficulty: 'medium' },
  { id: 'muhammad-ali', name: 'Muhammad Ali', category: 'sport', difficulty: 'medium' },
  { id: 'mike-tyson', name: 'Mike Tyson', category: 'sport', difficulty: 'medium' },
  { id: 'ayrton-senna', name: 'Ayrton Senna', category: 'sport', difficulty: 'hard' },
  { id: 'michael-schumacher', name: 'Michael Schumacher', category: 'sport', difficulty: 'medium' },
  { id: 'tiger-woods', name: 'Tiger Woods', category: 'sport', difficulty: 'medium' },

  // ── MUSIQUE ───────────────────────────────────────────────
  { id: 'elvis-presley', name: 'Elvis Presley', category: 'musique', difficulty: 'easy' },
  { id: 'michael-jackson', name: 'Michael Jackson', category: 'musique', difficulty: 'easy' },
  { id: 'madonna', name: 'Madonna', category: 'musique', difficulty: 'easy' },
  { id: 'beyonce', name: 'Beyoncé', category: 'musique', difficulty: 'easy' },
  { id: 'freddie-mercury', name: 'Freddie Mercury', category: 'musique', difficulty: 'medium' },
  { id: 'john-lennon', name: 'John Lennon', category: 'musique', difficulty: 'medium' },
  { id: 'bob-marley', name: 'Bob Marley', category: 'musique', difficulty: 'easy' },
  { id: 'david-bowie', name: 'David Bowie', category: 'musique', difficulty: 'medium' },
  { id: 'jimi-hendrix', name: 'Jimi Hendrix', category: 'musique', difficulty: 'medium' },
  { id: 'edith-piaf', name: 'Édith Piaf', category: 'musique', difficulty: 'medium' },
  { id: 'jacques-brel', name: 'Jacques Brel', category: 'musique', difficulty: 'hard' },
  { id: 'serge-gainsbourg', name: 'Serge Gainsbourg', category: 'musique', difficulty: 'medium' },
  { id: 'johnny-hallyday', name: 'Johnny Hallyday', category: 'musique', difficulty: 'easy' },
  { id: 'daft-punk', name: 'Daft Punk', category: 'musique', difficulty: 'medium' },
  { id: 'mozart', name: 'Mozart', category: 'musique', difficulty: 'easy' },
  { id: 'beethoven', name: 'Beethoven', category: 'musique', difficulty: 'easy' },
  { id: 'lady-gaga', name: 'Lady Gaga', category: 'musique', difficulty: 'easy' },
  { id: 'rihanna', name: 'Rihanna', category: 'musique', difficulty: 'easy' },
  { id: 'stromae', name: 'Stromae', category: 'musique', difficulty: 'medium' },
  { id: 'aya-nakamura', name: 'Aya Nakamura', category: 'musique', difficulty: 'medium' },

  // ── HISTOIRE ──────────────────────────────────────────────
  { id: 'napoleon-bonaparte', name: 'Napoléon Bonaparte', category: 'histoire', difficulty: 'easy' },
  { id: 'jules-cesar', name: 'Jules César', category: 'histoire', difficulty: 'easy' },
  { id: 'cleopatre', name: 'Cléopâtre', category: 'histoire', difficulty: 'easy' },
  { id: 'jeanne-darc', name: "Jeanne d'Arc", category: 'histoire', difficulty: 'easy' },
  { id: 'louis-xiv', name: 'Louis XIV', category: 'histoire', difficulty: 'medium' },
  { id: 'marie-antoinette', name: 'Marie-Antoinette', category: 'histoire', difficulty: 'medium' },
  { id: 'christophe-colomb', name: 'Christophe Colomb', category: 'histoire', difficulty: 'easy' },
  { id: 'leonard-de-vinci', name: 'Léonard de Vinci', category: 'histoire', difficulty: 'easy' },
  { id: 'galilee', name: 'Galilée', category: 'histoire', difficulty: 'medium' },
  { id: 'isaac-newton', name: 'Isaac Newton', category: 'histoire', difficulty: 'medium' },
  { id: 'albert-einstein', name: 'Albert Einstein', category: 'histoire', difficulty: 'easy' },
  { id: 'marie-curie', name: 'Marie Curie', category: 'histoire', difficulty: 'medium' },
  { id: 'nikola-tesla', name: 'Nikola Tesla', category: 'histoire', difficulty: 'medium' },
  { id: 'charles-de-gaulle', name: 'Charles de Gaulle', category: 'histoire', difficulty: 'medium' },
  { id: 'winston-churchill', name: 'Winston Churchill', category: 'histoire', difficulty: 'medium' },
  { id: 'gandhi', name: 'Gandhi', category: 'histoire', difficulty: 'medium' },
  { id: 'martin-luther-king', name: 'Martin Luther King', category: 'histoire', difficulty: 'medium' },
  { id: 'nelson-mandela', name: 'Nelson Mandela', category: 'histoire', difficulty: 'medium' },
  { id: 'vincent-van-gogh', name: 'Vincent van Gogh', category: 'histoire', difficulty: 'easy' },
  { id: 'pablo-picasso', name: 'Pablo Picasso', category: 'histoire', difficulty: 'easy' },
  { id: 'claude-monet', name: 'Claude Monet', category: 'histoire', difficulty: 'hard' },
  { id: 'william-shakespeare', name: 'William Shakespeare', category: 'histoire', difficulty: 'medium' },
  { id: 'victor-hugo', name: 'Victor Hugo', category: 'histoire', difficulty: 'medium' },
  { id: 'moliere', name: 'Molière', category: 'histoire', difficulty: 'medium' },
  { id: 'toutankhamon', name: 'Toutânkhamon', category: 'histoire', difficulty: 'medium' },
  { id: 'vercingetorix', name: 'Vercingétorix', category: 'histoire', difficulty: 'medium' },
  { id: 'neil-armstrong', name: 'Neil Armstrong', category: 'histoire', difficulty: 'medium' },
  { id: 'gustave-eiffel', name: 'Gustave Eiffel', category: 'histoire', difficulty: 'hard' },
  { id: 'alexandre-le-grand', name: 'Alexandre le Grand', category: 'histoire', difficulty: 'hard' },
  { id: 'spartacus', name: 'Spartacus', category: 'histoire', difficulty: 'hard' },

  // ── FICTION & CONTES ──────────────────────────────────────
  { id: 'sherlock-holmes', name: 'Sherlock Holmes', category: 'fiction', difficulty: 'easy' },
  { id: 'dracula', name: 'Dracula', category: 'fiction', difficulty: 'easy' },
  { id: 'frankenstein', name: 'Frankenstein', category: 'fiction', difficulty: 'easy' },
  { id: 'robin-des-bois', name: 'Robin des Bois', category: 'fiction', difficulty: 'easy' },
  { id: 'merlin', name: 'Merlin l’Enchanteur', category: 'fiction', difficulty: 'medium' },
  { id: 'zorro', name: 'Zorro', category: 'fiction', difficulty: 'easy' },
  { id: 'tarzan', name: 'Tarzan', category: 'fiction', difficulty: 'easy' },
  { id: 'le-petit-prince', name: 'Le Petit Prince', category: 'fiction', difficulty: 'easy' },
  { id: 'alice', name: 'Alice au pays des merveilles', category: 'fiction', difficulty: 'easy' },
  { id: 'le-chapelier-fou', name: 'Le Chapelier Fou', category: 'fiction', difficulty: 'medium' },
  { id: 'don-quichotte', name: 'Don Quichotte', category: 'fiction', difficulty: 'medium' },
  { id: 'robinson-crusoe', name: 'Robinson Crusoé', category: 'fiction', difficulty: 'medium' },
  { id: 'capitaine-nemo', name: 'Capitaine Nemo', category: 'fiction', difficulty: 'hard' },
  { id: 'dartagnan', name: "D'Artagnan", category: 'fiction', difficulty: 'medium' },
  { id: 'cyrano-de-bergerac', name: 'Cyrano de Bergerac', category: 'fiction', difficulty: 'medium' },
  { id: 'pinocchio', name: 'Pinocchio', category: 'fiction', difficulty: 'easy' },
  { id: 'le-pere-noel', name: 'Le Père Noël', category: 'fiction', difficulty: 'easy' },
  { id: 'petit-chaperon-rouge', name: 'Le Petit Chaperon Rouge', category: 'fiction', difficulty: 'easy' },
  { id: 'le-chat-botte', name: 'Le Chat Botté', category: 'fiction', difficulty: 'easy' },
  { id: 'boucle-dor', name: "Boucle d'or", category: 'fiction', difficulty: 'medium' },
  { id: 'hansel-et-gretel', name: 'Hansel et Gretel', category: 'fiction', difficulty: 'medium' },
  { id: 'la-belle-au-bois-dormant', name: 'La Belle au bois dormant', category: 'fiction', difficulty: 'easy' },
  { id: 'le-magicien-doz', name: "Le Magicien d'Oz", category: 'fiction', difficulty: 'medium' },
  { id: 'moby-dick', name: 'Moby Dick', category: 'fiction', difficulty: 'medium' },
  { id: 'docteur-jekyll', name: 'Docteur Jekyll', category: 'fiction', difficulty: 'hard' },
];

/**
 * Packs d'identités.
 *
 * Un pack sélectionne des identités par catégorie et/ou par appartenance
 * explicite (`Identity.packs`). Ajouter un pack = ajouter une entrée ici :
 * aucune autre partie du code n'a besoin de changer.
 */
export interface IdentityPack {
  id: string;
  label: string;
  categories?: Identity['category'][];
}

export const BASE_PACK_ID = 'base';

export const IDENTITY_PACKS: IdentityPack[] = [
  { id: BASE_PACK_ID, label: 'Toutes les identités' },
  { id: 'disney', label: 'Pack Disney', categories: ['disney'] },
  { id: 'cinema', label: 'Pack Cinéma', categories: ['cinema', 'serie'] },
  { id: 'enfants', label: 'Pack Enfants', categories: ['disney', 'animation', 'fiction'] },
  { id: 'culture', label: 'Pack Culture', categories: ['histoire', 'musique', 'celebrite'] },
];

/** Retourne les identités appartenant à au moins un des packs demandés. */
export function getIdentityPool(packIds: string[] = [BASE_PACK_ID]): Identity[] {
  if (packIds.includes(BASE_PACK_ID)) return IDENTITIES;

  const packs = IDENTITY_PACKS.filter((p) => packIds.includes(p.id));
  const categories = new Set(packs.flatMap((p) => p.categories ?? []));

  return IDENTITIES.filter(
    (identity) =>
      categories.has(identity.category) ||
      (identity.packs ?? []).some((p) => packIds.includes(p)),
  );
}

/** Index par id, construit une seule fois. */
export const IDENTITY_BY_ID: ReadonlyMap<string, Identity> = new Map(
  IDENTITIES.map((identity) => [identity.id, identity]),
);

export function getIdentity(id: string): Identity | undefined {
  return IDENTITY_BY_ID.get(id);
}

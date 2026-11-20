import csv, json
R='raw/'
# --- Londyn ---
st={r['id']:r for r in csv.DictReader(open(R+'london.stations.csv'))}
lines={r['line']:r for r in csv.DictReader(open(R+'london.lines.csv'))}
skip={'5','13'}  # East London (dziś Overground), DLR (naziemna)
deep={'1','2','7','9','10','11','12'}
lkeys=[k for k in lines if k not in skip]
L=[{'n':lines[k]['name'].replace(' Line',''),'c':'#'+('c8c8c8' if k=='9' else lines[k]['colour']),'d':[18,30] if k in deep else [7,11]} for k in lkeys]
li={k:i for i,k in enumerate(lkeys)}
used=set(); E=[]
for r in csv.DictReader(open(R+'london.connections.csv')):
    if r['line'] in skip: continue
    E.append([r['station1'],r['station2'],li[r['line']]]); used|={r['station1'],r['station2']}
ids=sorted(used,key=lambda i:st[i]['name']); idx={i:n for n,i in enumerate(ids)}
S=[[st[i]['name'],round(float(st[i]['latitude']),5),round(float(st[i]['longitude']),5)] for i in ids]
E=[[idx[a],idx[b],l] for a,b,l in E]
# rozszerzenie Northern (2021)
ken=[n for n,s in enumerate(S) if s[0]=='Kennington'][0]; nl=[i for i,l in enumerate(L) if l['n']=='Northern'][0]
S.append(['Nine Elms',51.4800,-0.1288]); S.append(['Battersea Power Station',51.4797,-0.1426])
E+= [[ken,len(S)-2,nl],[len(S)-2,len(S)-1,nl]]
london={'name':'Londyn','o':[51.5074,-0.1278],'lines':L,'st':S,'ed':E,'spawn':'Oxford Circus',
 'note':'Stacje i połączenia: zbiór danych nicola/tubemaps (ok. 2016) + linia Northern do Battersea. Bez DLR i Overground.'}
# --- Warszawa (współrzędne przybliżone) ---
M1=[('Kabaty',52.1314,21.0656),('Natolin',52.1402,21.0578),('Imielin',52.1497,21.0453),('Stokłosy',52.1559,21.0348),('Ursynów',52.1620,21.0275),('Służew',52.1733,21.0253),('Wilanowska',52.1810,21.0236),('Wierzbno',52.1898,21.0170),('Racławicka',52.1993,21.0125),('Pole Mokotowskie',52.2087,21.0081),('Politechnika',52.2190,21.0157),('Centrum',52.2310,21.0108),('Świętokrzyska',52.2355,21.0082),('Ratusz Arsenał',52.2449,21.0013),('Dworzec Gdański',52.2576,20.9947),('Plac Wilsona',52.2689,20.9853),('Marymont',52.2716,20.9719),('Słodowiec',52.2764,20.9608),('Stare Bielany',52.2817,20.9496),('Wawrzyszew',52.2859,20.9395),('Młociny',52.2912,20.9301)]
M2=[('Karolin (w budowie)',52.2262,20.8817),('Chrzanów (w budowie)',52.2312,20.8862),('Lazurowa (w budowie)',52.2393,20.8988),('Bemowo',52.2390,20.9118),('Ulrychów',52.2389,20.9297),('Księcia Janusza',52.2391,20.9443),('Młynów',52.2379,20.9582),('Płocka',52.2328,20.9666),('Rondo Daszyńskiego',52.2302,20.9840),('Rondo ONZ',52.2330,20.9978),('Świętokrzyska',52.2355,21.0082),('Nowy Świat-Uniwersytet',52.2368,21.0172),('Centrum Nauki Kopernik',52.2398,21.0303),('Stadion Narodowy',52.2467,21.0439),('Dworzec Wileński',52.2546,21.0348),('Szwedzka',52.2633,21.0446),('Targówek Mieszkaniowy',52.2715,21.0490),('Trocka',52.2767,21.0549),('Zacisze',52.2848,21.0509),('Kondratowicza',52.2925,21.0416),('Bródno',52.2935,21.0282)]
WS=[];wi={}
def sid(s):
    if s[0] not in wi: wi[s[0]]=len(WS); WS.append([s[0],s[1],s[2]])
    return wi[s[0]]
WE=[]
for li_,seq in enumerate([M1,M2]):
    for a,b in zip(seq,seq[1:]): WE.append([sid(a),sid(b),li_])
warsaw={'name':'Warszawa','o':[52.2297,21.0122],'lines':[{'n':'M1','c':'#3b7ddd','d':[10,14]},{'n':'M2','c':'#e3262e','d':[13,22]}],'st':WS,'ed':WE,'spawn':'Świętokrzyska',
 'note':'Kolejność stacji zgodna z rzeczywistością, położenia przybliżone (do ~150 m). Wczytany plik OSM ze stacjami poprawia je na dokładne.'}
d={'warszawa':warsaw,'londyn':london}
open('cities.json','w').write(json.dumps(d,ensure_ascii=False,separators=(',',':')))
print(len(WS),len(WE),len(S),len(E),len(json.dumps(d)))

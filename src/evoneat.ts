const fs: any = require("fs");

interface config {
    evaluatorPath: string,
    cExcess: number, //The compatibility constant for excess genes.
    cDisjoint: number, //The compatibility constant for disjoint genes.
    cMatching: number, //The compatibility constant for matching genes.
    deltaThreshold: number, //The compatibility threshold.
    cSmallGenome: number, //The maximum number of genes a genome can have to be considered small.
    cSmallSpecies: number, //The number of members a species has in order to be considered small.
    cStagnantSpecies: number, //The number of generations a species must remain static, in order to become stagnant.
    cCull: number, //The fraction of its population a species will be culled to.
    pCrossover: number, //The probability that two parents will crossover before mutating.
    pDisable: number, //The probability a gene will be disabled if it's disabled in either parent.
    pPerturb: number, //The probability a genome will have its connection weights perturbed.
    pPerturbUniform: number, //If a weight is to be perturbed, it will either be uniformly perturbed or set to a new value.
    pLink: number, //The probability of adding a new link during mutation.
    pNeuron: number, //The probability of adding a new neuron during mutation.
    pKeepNotFit: number, //Keep the matching Gene from the least fit Organism during crossover.
    newWeight: () => number, //The weight a new gene will spawn with.
    neuronActivation: (number) => number //The default activation function for all neurons.
}

const cfg: config = <config>require("./config.js");

interface os{
    cpus: () => Array<any>
}

const FARM_OPTIONS = {
    maxConcurrentWorkers: <os>require('os').cpus().length, //Fix?
    maxCallsPerWorker: Infinity,
    maxConcurrentCallsPerWorker: 1
};

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randEntry(arr: Array<any>) {
    return arr[randInt(0, arr.length - 1)];
}

function varundefined(val: any): boolean {
    return val === undefined || val === null;
}

function insertionSort(val: any, arr: Array<any>, compare: (a, b) => boolean) { //Maybe later.
    let i = 0;
    if (varundefined(arr)) return;
    do {
        if (varundefined(arr[i])) {
            break;
        }
        else {
            i++;
        }
    } while (compare(arr[i], val));
    arr.splice(i, 0, val);
}

function shufflearr(a: Array<any>) {
    let j, x, i;
    for (i = a.length; i; i--) {
        j = Math.floor(Math.random() * i);
        x = a[i - 1];
        a[i - 1] = a[j];
        a[j] = x;
    }
}

//I'd like these to belong in class Pool, due to their pool specific nature, but can't reference them from child objects.
let innovations = new Array<Array<number>>();
let innovationCount: number = 0;

function innovationCheck(Gene: Gene): number {
    let start = Gene.start;
    let target = Gene.target;

    function newInnovation() {
        this.innovationCount++;
        this.innovations[start][target] = this.innovationCount;
    }

    if (varundefined(this.innovations[start])) {
        this.innovations[start] = new Array<number>();
        newInnovation();
    }
    else if (varundefined(this.innovations[start][target])) {
        newInnovation();
    }
    return this.innovations[start][target];
}

let nInputs: number;
let nMaxHidden: number;
let nOutputs: number;
let nPopulation: number;

enum neuronPlace {
    INPUT = 1,
    HIDDEN = 2,
    OUTPUT = 3
}

enum neuronType {
    BIAS = -1,
    NULL = 0,
    SENSOR = 1,
    NEURON = 2
}

class Neuron {
    id: number;
    type: neuronType;
    place: neuronPlace;
    value: number = 0;
    frame: number = 0;
    linksIn: Array<Link> = [];

    constructor(what: neuronType, where: neuronPlace) {
        this.type = what;
        this.place = where;
    }

    activation() {
        this.value = cfg.neuronActivation(this.value);
        return this.value;
    }
}

class Link {
    start: number;
    target: number;
    weight: number;

    constructor(s, t, w) {
        this.start = s;
        this.target = t;
        this.weight = w;
    }
}

class Network {
    neurons: Array<Neuron>;
    frame: number = 0;

    constructor() {
        this.neurons = Array<Neuron>();
        this.neurons[0] = new Neuron(neuronType.BIAS, neuronPlace.INPUT);
        this.neurons[0].value = 1;

        for (let i = 1; i <= nInputs; i++) {
            this.neurons[i] = new Neuron(neuronType.SENSOR, neuronPlace.INPUT);
        }

        for (let o = 1; o <= nOutputs; o++) {
            this.neurons[nMaxHidden + nInputs + o] = new Neuron(neuronType.NEURON, neuronPlace.OUTPUT);
        }
    }

    pushLink(start, target, weight) {
        let s = this.neurons[start];
        let t = this.neurons[target];

        if (varundefined(s)) {
            s = new Neuron(neuronType.NEURON, neuronPlace.HIDDEN);
        }
        if (varundefined(t)) {
            t = new Neuron(neuronType.NEURON, neuronPlace.HIDDEN);
        }

        t.linksIn.push(new Link(start, target, weight));

        this.neurons[start] = s;
        this.neurons[target] = t;
    }

    private propagate(index: number): number { //Calculates and returns the value of a neuron.
        if (this.neurons[index].place == neuronPlace.INPUT || this.neurons[index].frame == this.frame) {
            return this.neurons[index].value;
        }
        else {
            let sum = 0;
            this.neurons[index].frame = this.frame;
            for (let val of this.neurons[index].linksIn) {
                sum += val.weight * this.propagate(val.start);
            }
            this.neurons[index].value = sum;

            return this.neurons[index].activation();
        }
    }

    run(inputs: Array<number>): Array<number> {
        this.frame++;

        if (inputs.length != nInputs) {
            console.log("Invalid number of inputs given during network execution.");
            return;
        }

        for (let i = 1; i <= nInputs; i++) {
            this.neurons[i].value = inputs[i - 1];
        }

        let outputs = new Array<number>();
        for (let o = 1; o <= nOutputs; o++) {
            let current = nInputs + nMaxHidden + o;
            outputs.push(this.propagate(current));
        }

        return outputs;
    }
}

class Gene {
    innovation: number;
    start: number;
    target: number;
    weight: number;
    enabled: boolean;

    constructor(s: number, t: number, w: number, e: boolean) {
        this.start = s;
        this.target = t;
        this.weight = w;
        this.enabled = e;
        this.innovation = innovationCheck(this);
    }

    perturb() {
        if (Math.random() < cfg.pPerturbUniform) {
            this.weight *= Math.random();
        }
        else {
            this.weight = cfg.newWeight();
        }
    }
}

class Organism {
    genome: Array<Gene> = [];
    maxNeuron: number = 0;
    innovationMin: number = Infinity;
    innovationMax: number = -Infinity;
    fitness: number;
    adjFitness: number;
    phenome: Network;

    sort() {
        function compare(a, b) {
            return a.innovation - b.innovation;
        }
        this.genome.sort(compare);
    }

    pushGene(gene: Gene) {
        this.innovationMin = Math.min(this.innovationMin, gene.innovation);
        this.innovationMax = Math.max(this.innovationMax, gene.innovation);
        this.genome.push(gene);
    }

    crossover(other: Organism): Organism {
        if (this.getFitness > other.getFitness) {
            var p1: Organism = this;
            var p2: Organism = other;
        }
        else {
            var p1: Organism = other;
            var p2: Organism = this;
        }

        let child = new Organism();

        let match = new Array<Gene>();
        for (let val of p2.genome) {
            match[val.innovation] = val;
        }

        for (let val of p1.genome) {
            let push: Gene = val;
            if (!varundefined(match[val.innovation])) {
                if (Math.random() < cfg.pKeepNotFit) {
                    push = match[val.innovation];
                }
                push.enabled = !((!val.enabled || !match[val.innovation].enabled) && Math.random() < cfg.pDisable);
            }
            child.pushGene(push);
        }

        return child;
    }

    /* Alternate crossover method. Requires sorted, by innovation, genomes.
    crossover(other: Organism): Organism{
        let i=0;
        let j=0;

        for(;;){
            let l=false;
            let k=false;
            if(i>=p1.genome.length){
                i=p1.genome.length-1;
                l=true;
            }
            if(j>=p2.genome.length){
                j=p2.genome.length-1;
                k=true;
            }
            let q={a: p1.genome[i], b: p2.genome[j], goa: l, gob: k};

            if(q.goa && q.gob) break;
            if(q.a.innovation==q.b.innovation){
                if(!q.b.enabled && Math.random()<pDisable){//If the b Gene is disabled and at a pDisable chance.
                    child.pushGene(q.b);
                }
                else{
                    child.pushGene(q.a);
                }
                i++;
                j++;
            }
            else if((q.a.innovation<q.b.innovation && !q.goa) || q.gob){
                child.pushGene(q.a);
                i++;
            }
            else if((q.a.innovation>q.b.innovation && !q.gob) || q.goa){
                child.pushGene(q.b);
                j++;
            }
        }

        return child;
    }
    */

    compatibility(other: Organism): number {
        let dis = 0;
        let exc = 0;
        let mat = 0;
        let wDif = 0;

        let exists = new Array<number>();
        let matching = new Array<boolean>();

        for (let val of other.genome) {
            exists[val.innovation] = val.weight;
        }

        for (let val of this.genome) {
            if (val.innovation < other.innovationMin || val.innovation > other.innovationMax) {
                exc++;
            }
            else {
                if (varundefined(exists[val.innovation])) {
                    dis++;
                }
                else {
                    wDif += Math.abs(val.weight - exists[val.innovation]);
                    mat++;
                    matching[val.innovation] = true;
                }
            }
        }
        for (let val of other.genome) {
            if (val.innovation < this.innovationMin || val.innovation > this.innovationMax) {
                exc++;
            }
            else if (matching[val.innovation] != true) {
                dis++;
            }
        }

        let maxlen = Math.max(this.genome.length, other.genome.length);
        let N = (maxlen > cfg.cSmallGenome) ? maxlen : 1;
        return (cfg.cDisjoint * dis / N) + (cfg.cExcess * exc / N) + (cfg.cMatching * wDif / mat);
    }

    compatible(other: Organism) {
        return this.compatibility(other) < cfg.deltaThreshold
    }

    /*Compatibility function for alternate method.
    compatibility(other: Organism){
        let i=0;
        let j=0;
        let dis=0;
        let exc=0;
        let mat=0;
        let wDif=0;

        let excuntilnow=true;
        for(;;){
            if(i>=this.genome.length-1 || j>=other.genome.length-1) break;
            if(this.genome[i].innovation==other.genome[j].innovation){
                excuntilnow=false;
                i++;
                j++;
                mat++;
                wDif+=Math.abs(this.genome[i].weight-other.genome[j].weight);
            }
            else if(this.genome[i].innovation<other.genome[j].innovation){
                i++;
                if(excuntilnow){
                    exc++;
                }
                else{
                    dis++;
                }
            }
            else if(this.genome[i].innovation>other.genome[j].innovation){
                j++;
                if(excuntilnow){
                    exc++;
                }
                else{
                    dis++;
                }
            }
        }
        exc+=(i>=this.genome.length)? other.genome.length-j+1 : this.genome.length-i+1;

        let maxlen=Math.max(this.genome.length, other.genome.length);
        let N=(maxlen>cSmallGenome)? maxlen : 1;
        return (cDisjoint*dis/N)+(cExcess*exc/N)+(cMatching*wDif/mat);
    }
    */

    private addLink(s: number, t: number, weight) {
        let gene = new Gene(s, t, weight, true);
        this.pushGene(gene);
    }

    /* Insertion sort addLink for the alternate crossover method.
    private addLink(s: number, t: number){
        let gen=new Gene(s, t, cfg.newWeight(), true);
        let i=this.genome.length-1;
        while(i>0 && this.genome[i]<this.genome[i-1]){
            swap(this.genome[i],this.genome[i-1]); //Check if swap actually changes anything in the array
            i--;
        }
    }
    */

    private randomNeuron(notInput: boolean): number {
        let count = 0;
        let exists = new Array<boolean>();

        if (!notInput) {
            for (let i = 0; i < nInputs; i++) {
                exists[i] = true;
                count++;
            }
        }

        for (let o = 1; o < nOutputs; o++) {
            exists[nMaxHidden + o] = true;
            count++;
        }

        for (let val of this.genome) {
            if (!(val.start <= nInputs && notInput)) {
                if (!exists[val.start]) count++;
                exists[val.start] = true;
            }

            if (!(val.target <= nInputs && notInput)) {
                if (!exists[val.target]) count++;
                exists[val.target] = true;
            }
        }

        let index = randInt(0, count);
        for (let val in exists) {
            index--;
            if (index == 0) {
                return parseInt(val);
            }
        }
    }

    private addNeuron(index: number) {
        this.genome[index].enabled = false;
        this.maxNeuron++;
        this.addLink(this.genome[index].start, this.maxNeuron, this.genome[index].weight);
        this.addLink(this.maxNeuron, this.genome[index].target, 1);
    }

    private perturbLinks() {
        for (let val of this.genome) {
            val.perturb();
        }
    }

    mutate() {
        if (Math.random() < cfg.pPerturb) {
            this.perturbLinks();
        }

        if (Math.random() < cfg.pLink) {
            let n2 = this.randomNeuron(true);
            let n1 = this.randomNeuron(false);
            this.addLink(n1, n2, cfg.newWeight);
        }

        if (Math.random() < cfg.pNeuron) {
            this.addNeuron(randInt(0, this.genome.length - 1));
        }
    }

    generate() {
        this.phenome = new Network;

        for (let val of this.genome) {
            if (val.enabled) {
                this.phenome.pushLink(val.start, val.target, val.weight);
            }
        }
    }

    getFitness() {
        /*if (varundefined(this.fitness)) {
            if (varundefined(this.phenome)) {
                this.generate();
            }
            this.evaluate();
        }*/

        return this.fitness;
    }

    evaluate(worker, callback) {
        let outputsConnected = false;

        for (let o = 1; o <= nOutputs; o++) {
            if (this.phenome.neurons[nMaxHidden + nInputs + o].linksIn.length > 0) {
                outputsConnected = true;
                break;
            }
        }

        if (outputsConnected) {
            //Run evaluator.
        }
        else {
            this.fitness = 0;
        }

        delete this.phenome;
    }
}

class Species {
    members: Array<Organism> = [];
    sumFitness: number = 0;
    sorted: boolean = false;
    stagnant: number = 0;
    prevMaxFitness: number = -Infinity;

    cull(allButTop: boolean): number { //Returns the number of members that got deleted.
        this.sortByFitness();

        if (allButTop) {
            let temp = this.members[0];

            if (temp.fitness <= this.prevMaxFitness) {
                this.stagnant++;
            }

            if (this.members.length <= cfg.cSmallSpecies) {
                this.members = [];
                this.members.push(temp);

                return this.members.length - 1;
            }
            else {
                return 0;
            }
        }
        else {
            let oglen = this.members.length;
            while (this.members.length > cfg.cCull * oglen && this.members.length > 1) {
                this.members.pop();
            }
            return oglen - this.members.length;
        }
    }

    sortByFitness() {
        if (!this.sorted) {
            this.members.sort(function(a, b) { return b.getFitness() - a.getFitness(); });
            this.sorted = true;
        }
    }

    breed() {
        let child: Organism;
        if (Math.random() < cfg.pCrossover) {
            let p1 = randEntry(this.members);
            let p2 = randEntry(this.members);
            child = (p1 == p2) ? p1 : p1.crossover(p2);
        }
        else {
            child = randEntry(this.members);
        }

        child.mutate();
        return child;
    }

    compatible(guy: Organism) {
        return this.members[0].compatible(guy);
    }

    addMember(newMember: Organism) {
        this.members.push(newMember);
        this.sorted = false;
        //insertionSort(newMember, this.members, function(a: Organism,b: Organism){return a.getFitness>b.getFitness;});
    }

    getAdjFitness(): number {
        this.sumFitness = 0;
        console.log(this.members);
        for (let val of this.members) {
            val.adjFitness = val.getFitness() / this.members.length; //This is where the evaluations are called?
            this.sumFitness += val.adjFitness;
        }
        return this.sumFitness;
    }
}

class Pool {
    species: Array<Species> = [];
    generation: number = 0;
    totalFitness: number;
    populationSize: number = 0;

    constructor(inputs: number, maxHidden: number, outputs: number, population: number) {
        nInputs = inputs;
        nMaxHidden = maxHidden;
        nOutputs = outputs;
        nPopulation = population;

        let sp = new Species;
        sp.members.push(new Organism);
        this.species.push(sp);
    }

    assignToSpecies(child: Organism) {
        for (let val of this.species) {
            if (val.compatible(child)) {
                val.addMember(child);
                return;
            }
        }

        let next = new Species;
        next.addMember(child);
        this.species.push(next);
        this.populationSize++;
    }

    cull(allButTop: boolean) {
        for (let val of this.species) {
            this.populationSize -= val.cull(allButTop);
        }
    }

    breed() {
        for (let val of this.species) {
            let times = Math.floor(val.getAdjFitness() / this.totalAdjFitness());
            for (let i = 0; i < times; i++) this.assignToSpecies(val.breed());
        }

        while (this.populationSize < nPopulation) {
            this.assignToSpecies(randEntry(this.species).breed());
        }
    }

    removeStagnant() {
        for (let i = 0; i < this.species.length; i++) {
            let member = this.species[i];
            if (member.stagnant >= cfg.cStagnantSpecies) {
                this.species.splice(i);
                i--;
            }
        }
    }

    totalAdjFitness(): number {
        if (!varundefined(this.totalFitness)) return this.totalFitness;

        for (let val of this.species) {
            this.totalFitness += val.getAdjFitness();
        }
        return this.totalFitness;
    }

    tellFitness(species: number, member: number, fitness: number){
        this.species[species].members[member].fitness=fitness;
    }

    evaluateAll(){
        let concurrent=workerFarm(FARM_OPTIONS, require.resolve(cfg.evaluatorPath));
        let count=this.populationSize;

        function tally(species: number, member: number, fitness: number){
            
        }

        for(let sp in this.species){
            let spe=this.species[sp];
            for(let me in spe){
                spe.members[1].evaluate(concurrent, tally);
            }
        }
    }

    nextGeneration() {
        this.cull(false);
        this.removeStagnant();
        this.breed();
        this.cull(true);

        this.generation++;

        let gen = this.generation;
        fs.writeFile("./saves/generation_" + this.generation + ".json", JSON.stringify(this), function(err) {
            if (err) {
                return console.log(err);
            }
            console.log("Backed up generation number " + gen + ".");
        });
    }
}

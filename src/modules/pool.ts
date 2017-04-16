import * as fs from 'fs';
import { Species } from './species';
import { Organism } from './organism';
import { Experiment } from './experiment';
import { randEntry } from './helper';

export class Pool {
	species: Array<Species> = [];
	generation: number = 0;
	totalAvgFitness: number;
	populationSize: number = 1;
	globalMax: number = 0; // Global maximum fitness.

	constructor(private experiment: Experiment) {

		let org = new Organism(this.experiment);
		org.addRandomLink();
		this.assignToSpecies(org);
	}

	assignToSpecies(child: Organism) {
		for (let val of this.species) {
			if (val.compatible(child)) {
				val.addMember(child);
				this.populationSize++;
				return;
			}
		}

		let next = new Species(this.experiment);
		next.addMember(child);
		this.species.push(next);
		this.populationSize++;
	}

	cull(allButTop: boolean) {
		for (let val of this.species) {
			this.populationSize -= val.cull(allButTop);
		}
	}

	removeStagnantSpecies() {
		let newSpecies = new Array<Species>();

		for (let val of this.species) {
			val.sortByFitness();

			if (val.members[0].fitness > val.maxFitness) {
				val.stagnant = 0;
				val.maxFitness = val.members[0].fitness;
			}
			else {
				val.stagnant++;
			}

			if (val.stagnant < this.experiment.config.cStagnantSpecies || val.maxFitness == this.globalMax) {
				newSpecies.push(val);
			}
		}

		if (newSpecies.length < this.experiment.config.cTopSpecies) {
			this.species = this.species.slice(0, this.experiment.config.cTopSpecies);
		}
		else {
			this.species = newSpecies;
		}
	}

	getTotalAvgFitness(): number {
		this.totalAvgFitness = 0;
		for (let val of this.species) {
			this.totalAvgFitness += val.getAvgFitness();
		}

		return this.totalAvgFitness;
	}

	getPopulationSize() {
		this.populationSize = 0;
		for (let val of this.species) {
			this.populationSize += val.members.length;
		}
	}

	iterate(callback) {
		if (this.species.length == 0) {
			console.log("dead");
			process.exit();
		}

		if (this.generation % this.experiment.config.backup == 0) {
			fs.writeFileSync("../saves/generationA_" + this.generation + ".json", JSON.stringify(this));
		}

		this.cull(false);
		this.removeStagnantSpecies();
		this.getPopulationSize();
		this.getTotalAvgFitness();

		if (this.generation % this.experiment.config.backup == 0) {
			fs.writeFileSync("../saves/generationB_" + this.generation + ".json", JSON.stringify(this));
		}

		let children = new Array<Organism>();
		let self = this;

		function assign() {
			pending--;

			if (pending == 0) {
				for (let val of children) {
					self.assignToSpecies(val);
				}

				if (self.generation % this.experiment.config.backup == 0) {
					fs.writeFileSync("../saves/generation_" + self.generation + ".json", JSON.stringify(self));
				}
				console.log("Completed generation number " + self.generation + ".");
				self.generation++;
				callback();
			}
		};

		let pending = 0;
		function addChild(child: Organism) {
			pending++;
			children.push(child);
		}

		for (let val of this.species) {
			let times = Math.floor(val.avgFitness / this.totalAvgFitness) * this.experiment.nPopulation - 1;
			for (let i = 0; i < times; i++) addChild(val.breed());
		}

		this.cull(true);
		this.getPopulationSize();

		if (this.generation % this.experiment.config.backup == 0) {
			fs.writeFileSync("../saves/generationC_" + this.generation + ".json", JSON.stringify(this));
		}

		while (this.populationSize + children.length < this.experiment.nPopulation) { // Filler!
			addChild(randEntry(this.species).breed());
		}

		children.forEach((child) => child.operate(assign));
	}

	loop(times: number) {
		let self = this;
		return new Promise((resolve, reject) => {
			let count = -1;

			function it() {
				count++;
				if (count >= times) {
					resolve();
					return;
				}

				if (count % 500 == 0) {
					process.nextTick(() => self.iterate(it));
					return;
				}

				self.iterate(it);
			}

			it();
		});
	}
}

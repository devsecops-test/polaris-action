const core = require('@actions/core');
const shell = require('shelljs');
const fs = require('fs');
const superagent = require('superagent');

try {
    const polarisServerUrl = core.getInput('polarisServerUrl');
    const polarisAccessToken = core.getInput('polarisAccessToken');
    const polarisProjectName = core.getInput('polarisProjectName');
    const polarisAdditionalArgs = core.getInput('polarisAdditionalArgs');
    const githubUrl = core.getInput('githubUrl');
    const githubCreds = core.getInput('githubCreds'); 

    const sarifOutputFileName = 'polaris-scan-results.sarif.json'
    var rcode = -1
    var rcode1 = -1

    //Polaris API
    const authAPI='/api/auth/v1/authenticate'
    const projectsAPI='/api/common/v0/projects'
    const issuesAPI='/api/query/v1/issues'
    const eventsAPI='/api/code-analysis/v0/events-with-source'

    let incremental=polarisAdditionalArgs.includes('--incremental');

    //invoke polaris scan
    console.log('Invoking polaris scan');
    if(incremental){
        console.log('Polaris Incremental Enabled');
        
        let curlCommand = 'curl -s ';
        
        if(githubCreds !== null && githubCreds !== ''){
            curlCommand = curlCommand.concat(`-u ${githubCreds} -X GET -G ${githubUrl} `);
        }
        else{
            curlCommand = curlCommand.concat(`-X GET -G ${githubUrl} `);
        }

        if(githubUrl.includes('pulls')){
            curlCommand = curlCommand.concat(` | jq -r '.[] | .filename' | tr " " "\n" > polaris-files-to-scan.txt`);
        }
        else{
            curlCommand = curlCommand.concat(` | jq .files | jq -r '.[] | .filename' | tr " " "\n" > polaris-files-to-scan.txt`);
        }

        console.log(curlCommand);

        rcode = shell.exec(curlCommand).code;
        if (rcode != 0){
            core.error(`Error: Fetching files changed from GitHub failed and returncode is ${rcode}`);
            core.setFailed(error.message);
        }
        
        console.log("Files changed in the commit")
        shell.exec(`cat polaris-files-to-scan.txt`).code;
        
        shell.exec(`wget -q ${polarisServerUrl}/api/tools/polaris_cli-linux64.zip`)
        shell.exec(`unzip -j polaris_cli-linux64.zip -d /tmp`)
        rcode1 = shell.exec(`export POLARIS_SERVER_URL=${polarisServerUrl} && export POLARIS_ACCESS_TOKEN=${polarisAccessToken} && export POLARIS_FF_ENABLE_COVERITY_INCREMENTAL=true && /tmp/polaris analyze -w ${polarisAdditionalArgs}`).code;

        if (rcode1 != 0){
            core.error(`Error: Polaris Scan failed and returncode is ${rcode1}`);
            core.setFailed(error.message);
        } 

    } else{
        shell.exec(`wget -q ${polarisServerUrl}/api/tools/polaris_cli-linux64.zip`)
        shell.exec(`unzip -j polaris_cli-linux64.zip -d /tmp`)
        rcode = shell.exec(`export POLARIS_SERVER_URL=${polarisServerUrl} && export POLARIS_ACCESS_TOKEN=${polarisAccessToken} && /tmp/polaris analyze -w ${polarisAdditionalArgs}`).code;

        if (rcode != 0){
            core.error(`Error: Polaris Execution failed and returncode is ${rcode}`);
            core.setFailed(error.message);
        }
    }

    console.log("Fetching Polaris Results")

    getIssues()

    function getIssues() {
        (async () => {
            try {
                //API Call to get token
                const tokenResponse = await superagent.post(polarisServerUrl+authAPI)
                .send({ accesstoken : polarisAccessToken})
                .set('Content-Type', 'application/x-www-form-urlencoded')
                let token = tokenResponse.body.jwt;

                //API Call to get projects
                const projectResponse = await superagent.get(polarisServerUrl+projectsAPI)
                .query('filter[project][name][$eq]='+polarisProjectName)
                .query('include[project][]=branches&page[limit]=500&page[offset]=0')
                .set('Authorization', 'Bearer '+token)
                let project_id = projectResponse.body.data[0].id;
                
                let branch_included = projectResponse.body.included;
                let branch_id;

                for (i = 0; i < branch_included.length; i++) {
                    if(projectResponse.body.included[i].attributes['main-for-project'] === true){
                        branch_id = projectResponse.body.included[i].id;
                    }
                }

                //API Call to get list of issues
                const issuesResponse = await superagent.get(polarisServerUrl+issuesAPI)
                .query('project-id='+project_id)
                .query('branch-id='+branch_id)
                .query('filter[issue][status][$eq]=opened&include[issue][]=severity&page[offset]=0&page[limit]=1000000000')
                .query('include[issue][]=issue-type&include[issue][]=path&include[issue][]=related-taxa')
                .set('Authorization', 'Bearer '+token)
                .accept('application/json')
                var issuesResponseData = issuesResponse.body.data;
                var issuesResponseIncluded = issuesResponse.body.included;
                
                console.log("Successfully fetched scan results from Polaris")
                var issues = [];

                for (i = 0; i < issuesResponseData.length; i++) {
                    if(Number(i % 50) === 0)
                    {
                        console.log(`Processing Issues ... ${i} / ${issuesResponseData.length}`)
                    }
                    
                    let issue = {issue_key: issuesResponseData[i].attributes['issue-key']};
                    issue.finding_key = issuesResponseData[i].attributes['finding-key'];
                    
                    //console.log(issue.issue_key);
                    //console.log(issuesResponseData[i]);

                    if(Object.keys(issuesResponseData[i].relationships.path).length !== 0){
                        issue.path_id = issuesResponseData[i].relationships.path.data.id;
                    }
                    else{
                        console.warn('Path ID not available for issue '+issue.issue_key);
                        issue.path_id = 'none';
                    }

                    if(Object.keys(issuesResponseData[i].relationships['issue-type']).length !== 0){
                        issue.issue_type_id = issuesResponseData[i].relationships['issue-type'].data.id;
                    }
                    else{
                        console.warn('Issue Type ID not available for issue '+issue.issue_key);
                        issue.issue_type_id = 'none';
                    }

                    if(Object.keys(issuesResponseData[i].relationships['latest-observed-on-run']).length !== 0){
                        issue.run_id = issuesResponseData[i].relationships['latest-observed-on-run'].data.id;
                    }
                    else{
                        console.warn('Run ID not available for issue '+issue.issue_key);
                        issue.run_id = 'none';
                    }

                    if(Object.keys(issuesResponseData[i].relationships.severity).length !== 0){
                        issue.severity = issuesResponseData[i].relationships.severity.data.id;
                    }
                    else{
                        console.warn('Severity ID not available for issue '+issue.issue_key);
                        issue.severity = 'none';
                    }

                    if(issuesResponseData[i].relationships['related-taxa'].data.length !== 0){
                        issue.cwe_id = issuesResponseData[i].relationships['related-taxa'].data[0].id;
                    }
                    else{
                        console.warn('CWE mapping not available for issue '+issue.issue_key);
                        issue.cwe_id = 'none';
                    }

                    for (j = 0; j < issuesResponseIncluded.length; j++) {
                        if(issue.issue_type_id === issuesResponseIncluded[j].id){
                            issue.issue_name = issuesResponseIncluded[j].attributes.name;
                            issue.issue_desc = issuesResponseIncluded[j].attributes.description;
                        } else if(issue.cwe_id === issuesResponseIncluded[j].id){
                            issue.cwe_map = 'CWE-'+issue.cwe_id+' : '+issuesResponseIncluded[j].attributes.description;
                            issue.cwe_tags = issuesResponseIncluded[j].attributes.name;
                        }
                    }

                    if(issue.cwe_id === 'none'){
                        issue.cwe_map = 'CWE-'+issue.cwe_id+' : '+issue.issue_desc;
                        issue.cwe_tags = 'none';
                    }

                    // API call to get main event line number
                    const issuesEventResponse = await superagent.get(polarisServerUrl+eventsAPI)
                    .query('finding-key='+issue.finding_key)
                    .query('run-id='+issue.run_id)
                    .set('Authorization', 'Bearer '+token)
                    .accept('application/json')
                    var issuesEventResponseData=issuesEventResponse.body.data;
                    issue.line_number = issuesEventResponseData[0]['main-event-line-number'];
                    var events = issuesEventResponseData[0].events;

                    for(k=0; k < events.length; k++)
                    {
                        if(events[k]['event-tag'] === 'remediation'){
                            issue.issue_recommendation = events[k]['event-description'];
                            issue.issue_desc = issue.issue_desc +' '+ issue.issue_recommendation
                        } else if (events[k]['event-type'] === 'MAIN'){
                            issue.issue_path = events[k].filePath;
                        }

                    }   
                    issues.push(issue);
                }
                //console.log('Issues list');
                //console.log(issues);

                //generate SARIF Report
                convertPipelineResultFileToSarifFile(issues, sarifOutputFileName);
            
            }  
            catch (error) {
                console.trace("Polaris Parsing failed");
                core.setFailed(error.message);
            }
        })();
    }

    // none,note,warning,error
    const impactToLevel = (impact => {
        switch (impact) {
            case "high":
            return "error";
            case "medium":
            return "warning";
            case "low":
            return "note";
            default:
            return "none";
        }
    })

    const addRuleToRules = (issue,rules) => {
        if (rules.filter(ruleItem => ruleItem.id===issue.cwe_id).length>0) {
            return null;
        }
        let rule = {
            id: issue.cwe_id,
            shortDescription: {
                text: "CWE-"+issue.cwe_id+": "+issue.issue_name
            },
            helpUri: "https://cwe.mitre.org/data/definitions/"+issue.cwe_id+".html",
            help: {
                text: issue.cwe_map
            },
            properties: {
                category: issue.cwe_tags
            },
            defaultConfiguration: {
                level: impactToLevel(issue.severity)
            }
        }

        return rule;
    }

    const convertPipelineResultFileToSarifFile = (inputData,outputFileName) => {
        console.log('Generating SARIF Report');

        let issues = inputData;
        console.log('Issues count: '+issues.length);

        let rules=[];

        // convert to SARIF json
        let sarifResults = issues.map(issue => {
            // append rule to ruleset - if not already there
            let rule = addRuleToRules(issue,rules);
            if (rule!==null){
                rules.push(rule);
            }

            let location = {
                physicalLocation: {
                    artifactLocation: {
                        uri: issue.issue_path
                    },
                    region: {
                        startLine: parseInt(issue.line_number)
                    }
                }
            }

            // get the severity according to SARIF
            let sarImp = impactToLevel(issue.severity);
            // populate issue
            let resultItem = {
                level: sarImp,
                message: {
                    text: issue.issue_desc,
                },
                locations: [location],
                ruleId: issue.cwe_id
            }
            return resultItem;
        })

        // construct the full SARIF content
        let sarifFileJSONContent = {
            $schema : "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
            version : "2.1.0",
            runs : [
                {
                    tool : {
                        driver : {
                            name : "Polaris Static Analysis Results",
                            rules: rules
                        }
                    },
                    results: sarifResults
                }   
            ]
        };

        //SARIF Output
        //console.log('SARIF file created: ');
        //console.log(JSON.stringify(sarifFileJSONContent, null, 2));

        // save to file
        fs.writeFileSync(outputFileName,JSON.stringify(sarifFileJSONContent, null, 2));
        console.log('SARIF file created: '+outputFileName);
    }

    module.exports = {
        convertToSarif: convertPipelineResultFileToSarifFile
    }
}
catch (error) {
    console.trace("Polaris execution failed");
    core.setFailed(error.message);
}

